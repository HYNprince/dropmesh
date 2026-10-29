import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import {
  ArrowRight, ArrowDownRight, AlertTriangle, BadgeCheck, Check, CheckCircle2, ChevronDown, Clock3, Copy, Download, FileUp, FolderOpen,
  Link2, LockKeyhole, MousePointerClick, QrCode, ScanLine, Send, ShieldCheck, Smartphone, Sparkles, Star, X, Zap,
} from 'lucide-react';
import {
  CHUNK_SIZE, MAX_BUFFERED, MAX_FILE, ROOM_LENGTH, codeFromHash,
  humanSize, isValidCode, pairingUrl, parseMeta, sanitizeFileName, sha256Hex, verifyReceivedParts,
  type FileMeta,
} from './lib/protocol';
import './style.css';

type Status = 'idle' | 'connecting' | 'waiting' | 'pairing' | 'connected' | 'disconnected';
type Transfer = '' | 'hashing' | 'offered' | 'sending' | 'receiving' | 'verifying' | 'awaiting' | 'complete';
type Signal = { type: 'offer' | 'answer' | 'candidate'; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
type ServerMessage = { type: string; room?: string; initiator?: boolean; data?: Signal; message?: string };
type Control = { type: string; id?: string } & Record<string, unknown>;
type Outbound = { meta: FileMeta; file: File; started: boolean };
type Inbound = { meta: FileMeta; approved: boolean; parts: BlobPart[]; bytes: number; verifying: boolean };

// Never silently connect a publicly deployed page to the visitor's own localhost.
// Local development still works without a .env file.
const SIGNAL_URL = import.meta.env.VITE_SIGNAL_URL || (import.meta.env.DEV ? 'ws://localhost:8787/signal' : '');
function validateSignalUrl(): string | null {
  if (!SIGNAL_URL) return 'DropMesh signaling is not configured. Set VITE_SIGNAL_URL to your hosted WSS endpoint and redeploy.';
  try {
    const parsed = new URL(SIGNAL_URL);
    if (parsed.pathname !== '/signal' || parsed.search || parsed.hash) return 'Signaling URL must end with /signal and have no query or fragment.';
    if (import.meta.env.PROD && parsed.protocol !== 'wss:') return 'Production signaling must use wss:// (encrypted WebSocket).';
    if (!['ws:', 'wss:'].includes(parsed.protocol)) return 'Signaling URL must begin with ws:// or wss://.';
    return null;
  } catch { return 'Signaling URL is invalid.'; }
}

function App() {
  const [room, setRoom] = useState('');
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [transfer, setTransfer] = useState<Transfer>('');
  const [incoming, setIncoming] = useState<FileMeta | null>(null);
  const [received, setReceived] = useState<{ name: string; url: string; sha256: string } | null>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [qr, setQr] = useState('');
  const [pairLink, setPairLink] = useState('');
  const [verifiedDigest, setVerifiedDigest] = useState('');
  const ws = useRef<WebSocket | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const dc = useRef<RTCDataChannel | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const candidates = useRef<RTCIceCandidateInit[]>([]);
  const outbound = useRef<Outbound | null>(null);
  const inbound = useRef<Inbound | null>(null);
  const cancelled = useRef(false);
  const downloadUrl = useRef('');
  const connectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (connectionTimer.current) clearTimeout(connectionTimer.current);
    if (peerTimer.current) clearTimeout(peerTimer.current);
    connectionTimer.current = null;
    peerTimer.current = null;
  }
  function clearReceived() {
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = '';
    setReceived(null);
    setVerifiedDigest('');
  }
  function resetTransfer() {
    cancelled.current = true;
    outbound.current = null;
    inbound.current = null;
    setIncoming(null);
    setTransfer('');
    setProgress(0);
  }
  function cleanup() {
    clearTimers();
    resetTransfer();
    dc.current?.close();
    pc.current?.close();
    ws.current?.close();
    dc.current = null;
    pc.current = null;
    ws.current = null;
  }
  useEffect(() => {
    const code = codeFromHash(location.hash);
    if (code) {
      setInput(code);
      history.replaceState(null, '', location.pathname + location.search);
    }
    return () => {
      cancelled.current = true;
      clearTimers();
      dc.current?.close();
      pc.current?.close();
      ws.current?.close();
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    };
  }, []);
  useEffect(() => {
    if (!isValidCode(room)) { setQr(''); setPairLink(''); return; }
    const link = pairingUrl(location.href, room);
    setPairLink(link);
    let active = true;
    QRCode.toDataURL(link, { width: 208, margin: 2, errorCorrectionLevel: 'Q', color: { dark: '#10232B', light: '#FFFFFF' } })
      .then(src => { if (active) setQr(src); })
      .catch(() => { if (active) setError('Could not generate QR code; copy the pairing link instead.'); });
    return () => { active = false; };
  }, [room]);

  function sendControl(message: object) {
    if (dc.current?.readyState === 'open') dc.current.send(JSON.stringify(message));
  }
  function signal(data: Signal) {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'signal', data }));
    }
  }
  function initializePeer(): RTCPeerConnection {
    pc.current?.close();
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.current = peer;
    peer.onicecandidate = e => {
      if (e.candidate) signal({ type: 'candidate', candidate: e.candidate.toJSON() });
    };
    peer.onconnectionstatechange = () => {
      if (peer !== pc.current) return;
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        setStatus('disconnected');
        resetTransfer();
        setError('Peer connection lost. Try another room or network.');
      }
    };
    peer.ondatachannel = e => configureChannel(e.channel);
    return peer;
  }
  async function finishIncoming(record: Inbound) {
    if (inbound.current !== record || !record.approved || record.verifying) return;
    record.verifying = true;
    setTransfer('verifying');
    try {
      const blob = await verifyReceivedParts(record.parts, record.meta);
      const actual = record.meta.sha256;
      if (inbound.current !== record) return;
      record.parts = [];
      inbound.current = null;
      setIncoming(null);
      clearReceived();
      const url = URL.createObjectURL(blob);
      downloadUrl.current = url;
      setReceived({ name: record.meta.name, url, sha256: actual });
      setVerifiedDigest(actual);
      setTransfer('complete');
      setProgress(100);
      sendControl({ type: 'verified', id: record.meta.id });
    } catch (err) {
      if (inbound.current === record) {
        inbound.current = null;
        setIncoming(null);
        setTransfer('');
        setError(err instanceof Error ? err.message : 'Could not verify the received file');
        sendControl({ type: 'integrity-failed', id: record.meta.id });
      }
    }
  }
  async function transmit(record: Outbound) {
    const channel = dc.current;
    if (!channel || channel.readyState !== 'open' || outbound.current !== record) return;
    setTransfer('sending');
    setProgress(0);
    try {
      let offset = 0;
      while (offset < record.file.size) {
        if (outbound.current !== record || cancelled.current || channel.readyState !== 'open') throw new Error('Transfer interrupted');
        if (channel.bufferedAmount > MAX_BUFFERED) {
          await new Promise<void>((resolve, reject) => {
            let timeout: ReturnType<typeof setTimeout>;
            const resume = () => { clearTimeout(timeout); channel.removeEventListener('bufferedamountlow', resume); resolve(); };
            timeout = setTimeout(() => { channel.removeEventListener('bufferedamountlow', resume); reject(new Error('Transfer stalled')); }, 20_000);
            channel.addEventListener('bufferedamountlow', resume, { once: true });
            if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) resume();
          });
          continue;
        }
        const next = Math.min(offset + CHUNK_SIZE, record.file.size);
        const buffer = await record.file.slice(offset, next).arrayBuffer();
        if (outbound.current !== record || channel.readyState !== 'open') throw new Error('Transfer interrupted');
        channel.send(buffer);
        offset = next;
        setProgress(Math.round(100 * offset / record.file.size));
      }
      if (outbound.current === record) setTransfer('awaiting');
    } catch (err) {
      if (outbound.current === record) {
        outbound.current = null;
        setTransfer('');
        setError(err instanceof Error ? err.message : 'Transfer failed');
      }
    }
  }
  function handleControl(message: Control) {
    if (message.type === 'meta') {
      const meta = parseMeta(message);
      if (!meta) { setError('Rejected invalid file metadata'); return; }
      if (inbound.current || outbound.current) { sendControl({ type: 'reject', id: meta.id }); return; }
      clearReceived();
      inbound.current = { meta, approved: false, parts: [], bytes: 0, verifying: false };
      setIncoming(meta);
      setTransfer('');
      setProgress(0);
      return;
    }
    const id = message.id;
    if (typeof id !== 'string') return;
    const out = outbound.current;
    if (message.type === 'accept' && out?.meta.id === id) {
      if (out.started) return;
      out.started = true;
      void transmit(out);
    } else if (message.type === 'reject' && out?.meta.id === id) {
      outbound.current = null;
      setTransfer('');
      setError('Receiver declined this file.');
    } else if (message.type === 'verified' && out?.meta.id === id) {
      outbound.current = null;
      setProgress(100);
      setTransfer('complete');
      setVerifiedDigest(out.meta.sha256);
    } else if (message.type === 'integrity-failed' && out?.meta.id === id) {
      outbound.current = null;
      setTransfer('');
      setError('Receiver reported a SHA-256 mismatch. Transfer rejected.');
    }
  }
  function handleBinary(data: ArrayBuffer) {
    const record = inbound.current;
    if (!record || !record.approved || record.verifying || record.bytes + data.byteLength > record.meta.size) {
      setError('Unexpected file data; closed the connection.');
      dc.current?.close();
      return;
    }
    record.parts.push(data);
    record.bytes += data.byteLength;
    setProgress(record.meta.size ? Math.round(100 * record.bytes / record.meta.size) : 100);
    if (record.bytes === record.meta.size) void finishIncoming(record);
  }
  function configureChannel(channel: RTCDataChannel) {
    dc.current = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 64 * 1024;
    channel.onopen = () => {
      if (peerTimer.current) clearTimeout(peerTimer.current);
      peerTimer.current = null;
      setStatus('connected');
      setError('');
    };
    channel.onclose = () => {
      if (channel !== dc.current) return;
      resetTransfer();
      setStatus(s => s === 'connected' ? 'disconnected' : s);
    };
    channel.onerror = () => setError('Data channel error');
    channel.onmessage = e => {
      if (typeof e.data === 'string') {
        if (e.data.length > 4096) return;
        try { const parsed: unknown = JSON.parse(e.data); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) handleControl(parsed as Control); }
        catch { setError('Ignored invalid control message'); }
      } else if (e.data instanceof ArrayBuffer) handleBinary(e.data);
    };
  }
  function start(mode: 'create' | 'join', code?: string) {
    const configError = validateSignalUrl();
    if (configError) { setError(configError); setStatus('idle'); return; }
    if (mode === 'join' && (!code || !isValidCode(code))) { setError('Enter a valid 12-character pairing code.'); return; }
    cleanup();
    cancelled.current = false;
    clearReceived();
    setRoom('');
    setError('');
    setStatus('connecting');
    if (mode === 'join') setRoom(code!);
    let socket: WebSocket;
    try { socket = new WebSocket(SIGNAL_URL); }
    catch { setStatus('idle'); setError('Invalid signaling server URL.'); return; }
    ws.current = socket;
    connectionTimer.current = setTimeout(() => {
      if (ws.current === socket && socket.readyState !== WebSocket.OPEN) {
        socket.close();
        setStatus('idle');
        setError('Signaling connection timed out.');
      }
    }, 15_000);
    socket.onopen = () => {
      if (connectionTimer.current) clearTimeout(connectionTimer.current);
      connectionTimer.current = null;
      socket.send(JSON.stringify(mode === 'create' ? { type: 'create' } : { type: 'join', room: code }));
    };
    socket.onerror = () => { if (socket === ws.current) setError('Cannot reach signaling server. Verify your server URL and network.'); };
    socket.onclose = () => {
      if (socket !== ws.current) return;
      if (connectionTimer.current) clearTimeout(connectionTimer.current);
      connectionTimer.current = null;
      setStatus(s => s === 'connected' ? s : 'idle');
      setError(previous => previous || 'Signaling disconnected; restart pairing if needed.');
    };
    socket.onmessage = async e => {
      if (socket !== ws.current) return;
      let message: ServerMessage;
      try { message = JSON.parse(e.data); } catch { return; }
      try {
        if (message.type === 'error') {
          setError(message.message || 'Server error');
          setStatus(current => current === 'connected' ? current : 'idle');
        } else if (message.type === 'room-created' && message.room && isValidCode(message.room)) {
          setRoom(message.room);
          setStatus('waiting');
        } else if (message.type === 'joined') {
          setStatus('waiting');
        } else if (message.type === 'room-expired' || message.type === 'host-left') {
          cleanup();
          setStatus('idle');
          setRoom('');
          setError('Room expired or host left. Create or join a new room.');
        } else if (message.type === 'peer-left') {
          if (peerTimer.current) clearTimeout(peerTimer.current);
          peerTimer.current = null;
          pc.current?.close();
          dc.current = null;
          pc.current = null;
          resetTransfer();
          setStatus('waiting');
          setError('Other device disconnected. You can wait for another device.');
        } else if (message.type === 'peer-ready') {
          const peer = initializePeer();
          candidates.current = [];
          if (peerTimer.current) clearTimeout(peerTimer.current);
          peerTimer.current = setTimeout(() => {
            if (pc.current === peer && dc.current?.readyState !== 'open') {
              peer.close();
              setStatus('disconnected');
              setError('Peer connection timed out. Try a different network or a TURN relay.');
            }
          }, 30_000);
          setStatus('pairing');
          if (message.initiator) {
            configureChannel(peer.createDataChannel('dropmesh-v2', { ordered: true }));
            await peer.setLocalDescription(await peer.createOffer());
            if (peer.localDescription) signal({ type: 'offer', sdp: peer.localDescription });
          }
        } else if (message.type === 'signal' && message.data && pc.current) {
          const peer = pc.current;
          if (message.data.type === 'offer' && message.data.sdp) {
            await peer.setRemoteDescription(message.data.sdp);
            await peer.setLocalDescription(await peer.createAnswer());
            if (peer.localDescription) signal({ type: 'answer', sdp: peer.localDescription });
          } else if (message.data.type === 'answer' && message.data.sdp) {
            await peer.setRemoteDescription(message.data.sdp);
          } else if (message.data.type === 'candidate' && message.data.candidate) {
            if (peer.remoteDescription) await peer.addIceCandidate(message.data.candidate);
            else candidates.current.push(message.data.candidate);
          }
          if (peer.remoteDescription) {
            for (const candidate of candidates.current.splice(0)) await peer.addIceCandidate(candidate);
          }
        }
      } catch {
        setError('Connection negotiation failed. Try a fresh room.');
      }
    };
  }
  function leave() {
    cleanup();
    clearReceived();
    setStatus('idle');
    setRoom('');
    setSelected(null);
    setError('');
  }
  function chooseFile(file: File | null) {
    if (file && file.size > MAX_FILE) { setError('Maximum supported file size is 100 MiB.'); return; }
    setSelected(file);
    setError('');
  }
  async function offerFile() {
    if (status !== 'connected' || !selected || outbound.current || inbound.current || dc.current?.readyState !== 'open') return;
    cancelled.current = false;
    setTransfer('hashing');
    setError('');
    setVerifiedDigest('');
    try {
      const file = selected;
      const sha256 = await sha256Hex(file);
      if (cancelled.current || dc.current?.readyState !== 'open') return;
      const meta: FileMeta = {
        type: 'meta', id: [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join(''),
        name: sanitizeFileName(file.name), size: file.size, mime: (file.type || 'application/octet-stream').slice(0, 120), sha256,
      };
      if (inbound.current || outbound.current) { setTransfer(''); setError('Another transfer is already active.'); return; }
      outbound.current = { meta, file, started: false };
      setTransfer('offered');
      sendControl(meta);
    } catch (err) {
      setTransfer('');
      setError(err instanceof Error ? err.message : 'Could not hash the file');
    }
  }
  function approve() {
    const record = inbound.current;
    if (!record || record.approved) return;
    record.approved = true;
    setIncoming(null);
    setTransfer('receiving');
    sendControl({ type: 'accept', id: record.meta.id });
    if (record.meta.size === 0) void finishIncoming(record);
  }
  function decline() {
    const record = inbound.current;
    if (!record) return;
    inbound.current = null;
    setIncoming(null);
    setTransfer('');
    sendControl({ type: 'reject', id: record.meta.id });
  }
  const statusLabels: Record<Status, string> = {
    idle: 'Not connected', connecting: 'Connecting to signaling server', waiting: 'Waiting for another device',
    pairing: 'Establishing encrypted channel', connected: 'Encrypted data channel active', disconnected: 'Peer disconnected',
  };
  const transferLabels: Record<Exclude<Transfer, ''>, string> = {
    hashing: 'Computing SHA-256 before sending', offered: 'Waiting for receiver approval', sending: 'Sending file data',
    receiving: 'Receiving file data', verifying: 'Verifying SHA-256 checksum', awaiting: 'Waiting for receiver integrity check',
    complete: 'SHA-256 verified — transfer complete',
  };
  const canOffer = status === 'connected' && !!selected && !outbound.current && !inbound.current && !['hashing','sending','verifying','awaiting'].includes(transfer);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const uploadBusy = ['hashing', 'offered', 'sending', 'receiving', 'verifying', 'awaiting'].includes(transfer);
  async function copyValue(value: string, item: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(item);
      window.setTimeout(() => setCopied(previous => previous === item ? null : previous), 2200);
    } catch {
      setError('Could not copy automatically. Select the code or link and copy it manually.');
    }
  }
  useEffect(() => {
    if (!qrOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setQrOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [qrOpen]);

  return <div className="app comic-app">
    <div className="page-confetti" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div>
    <header className="top">
      <a className="brand" href="/" aria-label="DropMesh home">
        <span className="brandmark"><Link2 size={27} strokeWidth={3}/></span>
        <span className="wordmark">drop<span>mesh</span><small>PEER TO PEER · ZERO FLUFF</small></span>
      </a>
      <nav className="topright" aria-label="Main navigation">
        <span className="header-note"><span className="online-dot"/> THE LITTLE FILE-TRANSFER MACHINE</span>
        <span className="version">V0.3 <Star size={13} fill="currentColor"/></span>
      </nav>
    </header>

    <main>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="eyebrow"><Zap size={15} fill="currentColor"/> THE INTERNET, BUT MORE FUN <Sparkles size={15}/></span>
          <h1 id="hero-title">YOUR FILES.<br/><span className="title-outline">YOUR RULES.</span><span className="hero-period">✦</span></h1>
          <p>Beam files from one device to another. No account. No file storage on our servers. Just a QR code, a high-five, and a verified transfer.</p>
          <div className="hero-actions">
            <a className="hero-cta" href="#transfer-desk">START SHARING <ArrowDownRight size={19} strokeWidth={3}/></a>
            <span className="hero-side"><ShieldCheck size={19}/> SHA-256 checked</span>
          </div>
          <div className="scribble" aria-hidden="true">NO CLOUD UPLOAD! <span>↗</span></div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-spark one">✦</div><div className="art-spark two">✳</div>
          <span className="comic-bubble bubble-up">ZIP! <i>⚡</i></span>
          <div className="art-device laptop"><div className="laptop-bar"><b/><b/><b/></div><div className="laptop-inner"><FolderOpen size={54} strokeWidth={2.3}/><span>BIG IDEAS.ZIP</span></div></div>
          <div className="art-trail"><span>•</span><span>•</span><span>•</span><span>➜</span></div>
          <div className="art-device phone"><span className="phone-notch"/><div className="phone-inner"><CheckCircle2 size={44} strokeWidth={2.8}/><span>GOT IT!</span></div><span className="phone-home"/></div>
          <span className="comic-bubble bubble-down">WHOOSH!</span>
          <div className="art-sticker">SHA-256<small>BYTE CHECK</small></div>
        </div>
      </section>

      <div className="comic-ticker" aria-hidden="true"><span>✳ SCAN IT</span><span>✦ SEND IT</span><span>★ VERIFY IT</span><span>✳ NO SIGN-UP</span><span>✦ SCAN IT</span><span>★ SEND IT</span></div>

      <section className="desk" id="transfer-desk" aria-label="Transfer desk">
        <div className="desk-heading">
          <div><span className="micro-label"><span className="tiny-star">✳</span> YOUR TRANSFER HEADQUARTERS</span><h2>Let’s make a <em>drop.</em></h2></div>
          <div className={'desk-state ' + (status === 'connected' ? 'desk-state-live' : '')}><span className="statusdot"/>{status === 'connected' ? 'PEER CONNECTED' : status === 'idle' ? 'AWAITING CONNECTION' : statusLabels[status].toUpperCase()}</div>
        </div>
        <div className="workspace">
          <section className="panel primary" aria-label="Connect devices">
            <div className="panel-topline"><span className="num">01 / PAIR UP</span><span className="panel-doodle">✳</span></div>
            <div className="paneltitle"><div><h3>Make a connection<span className="heading-dot">.</span></h3><p>One room. Two devices. Endless possibilities.</p></div><div className="icon-burst"><QrCode size={29}/></div></div>
            {status === 'idle' ? <div className="connect">
              <button className="mainbtn comic-button" onClick={() => start('create')}><span><Zap size={18} fill="currentColor"/> CREATE A ROOM</span><ArrowRight size={22}/></button>
              <div className="or"><span/> ALREADY GOT A CODE? <span/></div>
              <form className="join" onSubmit={e => { e.preventDefault(); if (isValidCode(input)) start('join', input); }}>
                <input aria-label="12-character pairing code" placeholder="PASTE YOUR SECRET CODE" value={input} maxLength={ROOM_LENGTH} onChange={e => setInput(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))} spellCheck={false} autoComplete="off"/>
                <button className="join-btn" type="submit" aria-label="Join room" disabled={!isValidCode(input)}><ArrowRight size={21}/></button>
              </form>
              <div className="little-note"><LockKeyhole size={16}/> Keep your room code private. Treat it like a one-time password.</div>
            </div> : <div className="active">
              {room && <><div className="roomlabel">YOUR SECRET ROOM CODE <span>DON'T SHARE PUBLICLY</span></div>
                <div className="roomcode"><span>{room}</span><button aria-label="Copy pairing code" title="Copy pairing code" onClick={() => void copyValue(room, 'code')}>{copied === 'code' ? <Check size={22}/> : <Copy size={22}/>}</button></div>
                <div className="secret-hint"><Clock3 size={15}/> Waiting rooms expire after 10 minutes.</div></>}
              {room && qr && <div className="qr-pair">
                <button className="qr-image-button" type="button" onClick={() => setQrOpen(true)} aria-label="Enlarge the pairing QR code"><img src={qr} alt="DropMesh pairing QR code" width="144" height="144"/><span><ScanLine size={14}/> ENLARGE</span></button>
                <div className="qr-instructions"><span className="qr-sticker">SCAN ME!</span><strong><Smartphone size={16}/> Add your second device</strong><p>Scan the QR to fill the code, then tap Join. For phones, you'll need a deployed HTTPS URL.</p><button className="copy-link" onClick={() => void copyValue(pairLink, 'link')}>{copied === 'link' ? <Check size={15}/> : <Copy size={15}/>} {copied === 'link' ? 'COPIED!' : 'COPY INVITE LINK'}</button></div>
              </div>}
              <div className={'connection ' + (status === 'connected' ? 'connected' : '')}><span className="statusdot"/><div><strong>{status === 'connected' ? 'KAPOW! Devices are linked.' : statusLabels[status]}</strong><small>{status === 'connected' ? 'Your peer-to-peer channel is ready to send.' : 'Keep this tab open while pairing.'}</small></div></div>
              <button className="textbtn" onClick={leave}><X size={16}/> LEAVE ROOM</button>
            </div>}
          </section>

          <section className="panel upload-panel" aria-label="Send a file">
            <div className="panel-topline"><span className="num">02 / SEND STUFF</span><span className="panel-doodle">✦</span></div>
            <div className="paneltitle"><div><h3>Drop it like it's hot<span className="heading-dot">!</span></h3><p>Photos, PDFs, and more. Up to 100 MiB per file.</p></div><div className="icon-burst upload-burst"><FileUp size={28}/></div></div>
            <div className={'drop ' + (dragActive ? 'drag-active ' : '') + (status === 'connected' ? 'enabled' : '')}
              onDragEnter={e => { e.preventDefault(); setDragActive(true); }}
              onDragOver={e => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={e => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragActive(false); }}
              onDrop={e => {e.preventDefault();setDragActive(false);chooseFile(e.dataTransfer.files[0] || null);}}
              onClick={() => fileInput.current?.click()} role="button" tabIndex={0}
              onKeyDown={e => {if (e.key === 'Enter' || e.key === ' ') { e.preventDefault();fileInput.current?.click(); }}}
              aria-label={selected ? `Selected ${selected.name}, click to change` : 'Choose a file to send'}>
              <input ref={fileInput} type="file" hidden onChange={e => chooseFile(e.target.files?.[0] || null)}/>
              <div className="drop-illustration"><span className="drop-rays">✳</span><FolderOpen size={44} strokeWidth={2}/><span className="drop-plus">+</span></div>
              {selected ? <><strong className="filename">{selected.name}</strong><span className="drop-sub">{humanSize(selected.size)} · CLICK TO SWITCH FILE</span></> : <><strong>{dragActive ? 'LET IT DROP!' : 'DRAG & DROP IT HERE'}</strong><span className="drop-sub">or click to pick your file</span></>}
            </div>
            <div className="filebottom"><span><ShieldCheck size={17}/> SHA-256 integrity check</span><span>LIMIT: 100 MiB</span></div>
            <button className="sendbtn comic-button" onClick={() => void offerFile()} disabled={!canOffer}><span><Send size={19}/> {uploadBusy ? 'TRANSFER IN PROGRESS…' : 'SEND & VERIFY'}</span><ArrowRight size={21}/></button>
            {status !== 'connected' && <p className="file-hint">Psst! Connect another device first to unlock sending.</p>}
          </section>
        </div>
        {incoming && <section className="notice incoming" role="status"><div className="notice-icon"><FileUp size={25}/></div><div className="notice-copy"><span className="micro-label">INCOMING DELIVERY!</span><strong>{incoming.name}</strong><p>{humanSize(incoming.size)} · Sender-provided hash: {incoming.sha256.slice(0, 16)}…</p></div><div className="notice-actions"><button className="accept" onClick={approve}><Check size={18}/> ACCEPT</button><button className="decline" aria-label="Decline file" onClick={decline}><X size={19}/></button></div></section>}
        {transfer && <section className={'notice progress ' + (transfer === 'complete' ? 'is-complete' : '')} role="status" aria-live="polite">
          <div className="progressHead"><div><span className="micro-label">{transfer === 'complete' ? 'MISSION COMPLETE ✳' : 'CURRENT MISSION'}</span><strong>{transferLabels[transfer]}</strong></div><span className="progressNum">{progress}%</span></div>
          <div className="progressBar" role="progressbar" aria-label="Transfer progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: progress + '%' }}/></div>
          {verifiedDigest && <p className="digest">SHA-256 <code>{verifiedDigest}</code></p>}
          {received && <a href={received.url} download={received.name} className="download"><Download size={19}/> DOWNLOAD {received.name} <ArrowRight size={18}/></a>}
        </section>}
        {error && <div className="error" role="alert"><AlertTriangle size={20}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={18}/></button></div>}
        <div className="safety-line"><ShieldCheck size={17}/><span>Built for file integrity, not identity verification. Share only with someone you trust.</span><button type="button" onClick={() => setShowHelp(!showHelp)} aria-expanded={showHelp}>HOW SAFE IS IT? <ChevronDown size={15}/></button></div>
        {showHelp && <div className="safety-extra">WebRTC encrypts the data channel; SHA-256 detects changes relative to the hash supplied by the sender. Room codes are bearer secrets, not identity proof. There is currently no TURN relay, so some networks cannot connect. Never use this beta for sensitive files.</div>}
      </section>

      <section className="features" aria-label="Features">
        <div className="feature-card lime"><ShieldCheck size={27}/><strong>SHA-256 CHECKED</strong><p>Received bytes get checked against the sender's hash.</p><span>✦</span></div>
        <div className="feature-card pink"><Link2 size={27}/><strong>DIRECT CHANNEL</strong><p>Files travel over the peer connection, not our app server.</p><span>✳</span></div>
        <div className="feature-card blue"><QrCode size={27}/><strong>QR POWER</strong><p>Pair using a scannable invite or a 12-character code.</p><span>★</span></div>
      </section>

      <section className="how" aria-label="How it works"><div className="how-head"><span className="eyebrow">THE THREE-STEP SECRET</span><h2>Easy as <span>1, 2, ZAP!</span></h2></div>
        <div className="steps">
          <div><span className="step-tag">01</span><QrCode size={31}/><h3>SCAN THE CODE</h3><p>Open a temporary room and invite your other device.</p></div>
          <div><span className="step-tag">02</span><MousePointerClick size={31}/><h3>SAY YES</h3><p>The receiver must approve before file data is sent.</p></div>
          <div><span className="step-tag">03</span><BadgeCheck size={31}/><h3>CHECK THE BYTES</h3><p>Download only after the received file passes verification.</p></div>
        </div>
      </section>
    </main>

    <footer><span className="footer-brand">DROP<span>MESH</span> <span className="footer-star">✳</span></span><span>MADE TO MOVE FILES, NOT COLLECT THEM.</span><span>v0.3 · BETA · NO IDENTITY VERIFICATION</span></footer>

    {qrOpen && qr && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setQrOpen(false); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Enlarged QR pairing code"><div className="modal-header"><span>SCAN TO JOIN!</span><button onClick={() => setQrOpen(false)} aria-label="Close QR code"><X size={21}/></button></div><img src={qr} alt="Large QR code for pairing"/><p>Anyone with this code can attempt to join. Only share privately.</p><button className="mainbtn comic-button" onClick={() => void copyValue(pairLink, 'link')}>{copied === 'link' ? <Check size={19}/> : <Copy size={19}/>} {copied === 'link' ? 'LINK COPIED!' : 'COPY INVITE LINK'}</button></div>
    </div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
