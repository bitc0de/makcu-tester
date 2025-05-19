import React, { useState, useRef, useEffect } from 'react';
import './cyberpunk.css';

export default function SerialConsole() {
  const [baudRate, setBaudRate] = useState(4000000);
  const [version, setVersion] = useState('3.0');
  const [log, setLog] = useState('');
  const [commandInput, setCommandInput] = useState('');
  const [aimTargets, setAimTargets] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTestingAim, setIsTestingAim] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [bytesSent, setBytesSent] = useState(0);
  const [bytesReceived, setBytesReceived] = useState(0);
  const [startTime, setStartTime] = useState(null);
  const [uptime, setUptime] = useState(0);
  const baudChangeCommand = new Uint8Array([0xDE, 0xAD, 0x05, 0x00, 0xA5, 0x00, 0x09, 0x3D, 0x00]);
  const portRef = useRef(null);
  const writerRef = useRef(null);
  const logRef = useRef(null);
  const [isTestingButtons, setIsTestingButtons] = useState(false);
  const [activeButton, setActiveButton] = useState(null);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState(0);



  useEffect(() => {
    if (!startTime) return;
    const id = setInterval(() => {
      setUptime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startTime]);
  

  const runBenchmark = async () => {
    setIsTestingAim(false);
    setIsTestingButtons(false);
    setIsBenchmarking(true);
    setBenchmarkProgress(0);
  
    const iterations = 100;
    const start = performance.now();
  
    for (let i = 0; i < iterations; i++) {
      setBenchmarkProgress(i + 1);
      await sendCommand('km.middle(1)');
      await new Promise(r => setTimeout(r, 1));
      await sendCommand('km.middle(0)');
      await new Promise(r => setTimeout(r, 1));
    }
  
    const end = performance.now();
    const duration = ((end - start) / 1000).toFixed(2);
    const rate = (iterations / (end - start) * 1000).toFixed(1);
  
    appendLog(`[BENCHMARK] ${iterations} clicks`);
    appendLog(`[TIME] ${duration}s`);
    appendLog(`[RATE] ${rate} clicks/sec`);
  
    setIsBenchmarking(false);
    setBenchmarkProgress(0);
  };
  

  // Append to log
  const appendLog = text => {
    setLog(l => l + text + '\n');
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, 0);
  };

  // Connect / reconnect
  const connectSerial = async () => {
    if (portRef.current) {
      try {
        writerRef.current?.releaseLock();
        await portRef.current.close();
      } catch {}
      portRef.current = null;
      writerRef.current = null;
      setDeviceInfo(null);
    }
  
    try {
      const port = await navigator.serial.requestPort();
      const decoder = new TextDecoder();
  
      // Abrimos primero a 115200
      await port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none' });
      portRef.current = port;
      const writer = port.writable.getWriter();
      const reader = port.readable.getReader();
  
      await writer.write(new TextEncoder().encode('km.version()\r'));
  
      let received = '';
      const timeout = new Promise(resolve => setTimeout(resolve, 300));
      const read = reader.read().then(({ value }) => {
        if (value) received += decoder.decode(value);
      });
  
      await Promise.race([read, timeout]);
  
      await reader.cancel();
      reader.releaseLock();
      writer.releaseLock();

      appendLog(received);
  
      if (received.includes('km.MAKCU')) {
        writerRef.current = await port.writable.getWriter();
        appendLog('[CONNECTED] Baud: 115200');
        setBaudRate(115200);
      } else {
        await port.close();
        await new Promise(r => setTimeout(r, 100));
        await port.open({ baudRate: 4000000, dataBits: 8, stopBits: 1, parity: 'none' });
        portRef.current = port;
        writerRef.current = port.writable.getWriter();
        appendLog('[CONNECTED] Baud: 4000000');
        setBaudRate(4000000);
      }
  
      if (version === '3.2') {
        await writerRef.current.write(new TextEncoder().encode('km.buttons(1)\r'));
        appendLog('Enabling button mask mode (v3.2)');
      }
  
      const finalReader = port.readable.getReader();
      let lastValue = 0;
  
      function countBits(n) {
        return n.toString(2).split('1').length - 1;
      }
      if (version === '3.2') {
        ;(async () => {
          while (true) {
            try {
              const { value, done } = await finalReader.read();
              if (done) break;
              if (!value) continue;
    
              setBytesReceived(r => r + value.length);
    
              
              for (let i = 0; i < value.length; i++) {
                const byte = value[i];
                if (byte > 31 || countBits(byte) !== 1) continue;
                const newlyPressed = (byte ^ lastValue) & byte;
                if (newlyPressed === (1 << 0)) appendLog('🖱️ LEFT');
                else if (newlyPressed === (1 << 1)) appendLog('🖱️ RIGHT');
                else if (newlyPressed === (1 << 2)) appendLog('🖱️ MIDDLE');
                else if (newlyPressed === (1 << 3)) appendLog('🖱️ BUTTON 4');
                else if (newlyPressed === (1 << 4)) appendLog('🖱️ BUTTON 5');
                lastValue = byte;
              }
              continue;
            
    
              const txt = decoder.decode(value);
              appendLog(`[RECV] ${txt.trim()}`);
            } catch (err) {
              appendLog(`[READ ERROR] ${err.message}`);
              break;
            }
          }
        })();
      }
  
      setStartTime(Date.now());
      setDeviceInfo({ dataBits: 8, stopBits: 1 });
  
    } catch (e) {
      appendLog(`[ERROR] ${e.message}`);
    }
  };
  
  
  
  
  
  

  // Send generic command
  const sendCommand = async cmd => {
    if (!writerRef.current) return;
    const data = new TextEncoder().encode(cmd + '\r');
    setBytesSent(s => s + data.length);
    appendLog(`[SEND] ${cmd}`);
    await writerRef.current.write(data);
  };

  // Manual input
  const handleSendInput = async () => {
    const cmd = commandInput.trim();
    if (!cmd) return;
    await sendCommand(cmd);
    setCommandInput('');
  };

  // Aim test
  const testAim = () => {
    setIsTestingButtons(false); // <-- añade esto
    setActiveButton(null); // por si estaba activo alguno
    const pts = Array.from({ length: 20 }, () => ({ x: Math.random()*700+50, y: Math.random()*500+50 }));
    setAimTargets(pts);
    setCurrentIndex(0);
    setIsTestingAim(true);
    appendLog('[TEST AIM] Click on red circle');
  };
  

  const startButtonTest = async () => {
    setIsTestingButtons(true);
    const buttons = ['left', 'right', 'middle', 'side1', 'side2'];
  
    for (const btn of buttons) {
      setActiveButton(btn);
      await sendCommand(`km.${btn}(1)`);
      await new Promise(r => setTimeout(r, 50));
      await sendCommand(`km.${btn}(0)`);
      await new Promise(r => setTimeout(r, 300));
    }
  
    setActiveButton(null);
    setIsTestingButtons(false);
    appendLog('[TEST BUTTONS] Completed');
  };
  

  const handleAimClick = async () => {
    if (!isTestingAim) return;
    const t = aimTargets[currentIndex];
    const zone = document.getElementById('aim-zone').getBoundingClientRect();
  
    if (version === '3.2') {
      const centerX = zone.width / 2;
      const centerY = zone.height / 2;
      const dx = Math.round(t.x - centerX + 10);
      const dy = Math.round(t.y - centerY + 10);
      await sendCommand(`km.move(${dx},${dy})`);
      await new Promise(r => setTimeout(r, 100));
      await sendCommand('km.left(1)');
      await new Promise(r => setTimeout(r, 50));
      await sendCommand('km.left(0)');
      await sendCommand(`km.move(${-dx},${-dy})`);
      await new Promise(r => setTimeout(r, 50));
    } else {
      const dx = Math.round((zone.left + t.x + 10) - (zone.left + zone.width / 2));
      const dy = Math.round((zone.top + t.y + 10) - (zone.top + zone.height / 2));
      await sendCommand(`km.move(${dx},${dy})`);
      await new Promise(r => setTimeout(r, 100));
      await sendCommand('km.left(1)');
      await new Promise(r => setTimeout(r, 50));
      await sendCommand('km.left(0)');
      await sendCommand(`km.move(${-dx},${-dy})`);
    }
  
    appendLog(`[SHOT] ${currentIndex + 1}`);
    const nxt = currentIndex + 1;
    if (nxt < aimTargets.length) {
      setCurrentIndex(nxt);
      appendLog(`[TEST AIM] Click target #${nxt + 1}`);
    } else {
      setIsTestingAim(false);
      setAimTargets([]);
      appendLog('[TEST AIM] Completed');
    }
  };
  
  

  const downloadCH343Driver = () => {
    const url = "https://www.wch.cn/download/file?id=315"
    const a = document.createElement('a');
    a.href = url;
    a.download = 'CH343.exe';
    a.click();
  };

  const downloadAIOTool = () => {
    const url = "https://cdn.discordapp.com/attachments/1323462636301586443/1371446058433122304/MAKCU_V2.5.exe?ex=682bbbec&is=682a6a6c&hm=dfe264767e237390842d53383987903df34eb8708442b6915f47f77e2e825893&"
    const a = document.createElement('a');
    a.href = url;
    a.download = 'MAKCU_V2.5.exe';
    a.click();
  };

  const MouseSVG = ({ activeId}) => (
      <svg width="229pt" height="361pt" viewBox="0 0 229 361" version="1.1" xmlns="http://www.w3.org/2000/svg">
      <g id="#000000ff">
      <path fill="#000000" opacity="1.00" d=" M 135.31 49.94 C 135.39 40.19 135.30 30.43 135.32 20.68 C 138.27 20.73 141.22 20.75 144.17 20.73 C 144.06 30.82 144.30 40.91 144.04 50.99 C 143.96 57.53 139.94 63.02 135.24 67.18 C 131.62 71.25 126.70 74.46 124.36 79.48 C 123.71 89.59 124.14 99.79 124.10 109.94 C 125.06 113.39 129.71 111.54 132.34 111.98 C 132.34 149.65 132.31 187.32 132.33 224.99 C 123.96 225.00 115.59 225.01 107.21 224.99 C 107.25 187.32 107.20 149.66 107.22 111.99 C 109.97 111.89 112.98 112.53 115.44 110.94 C 115.38 101.97 115.44 93.00 115.40 84.04 C 115.23 78.55 116.92 72.82 120.82 68.84 C 124.51 65.20 128.13 61.50 131.82 57.87 C 133.99 55.82 135.46 52.98 135.31 49.94 M 114.63 157.89 C 114.55 164.93 114.54 171.99 114.61 179.03 C 114.49 181.68 116.62 183.47 118.81 184.44 C 122.37 184.76 125.45 181.61 125.20 178.07 C 125.19 171.35 125.31 164.62 125.13 157.91 C 124.98 155.06 122.50 153.36 120.00 152.62 C 117.42 153.25 114.55 154.85 114.63 157.89 Z" />
      <path id="right"  className={`mouse-part ${activeId === 'right' ? 'active' : ''}`} fill="#000000" opacity="1.00" d=" M 138.64 105.12 C 139.47 104.41 140.01 102.92 141.34 103.25 C 153.20 119.59 170.75 130.79 188.71 139.42 C 190.60 140.10 190.58 142.37 191.02 143.99 C 195.36 164.78 192.70 186.20 189.36 206.93 C 172.71 207.09 156.06 206.97 139.42 206.98 C 139.27 195.67 139.57 184.34 138.97 173.03 C 138.86 150.40 138.91 127.76 138.64 105.12 Z" />
      <path id="left"  className={`mouse-part ${activeId === 'left' ? 'active' : ''}`} fill="#000000" opacity="1.00" d=" M 87.97 114.98 C 91.77 111.40 95.06 106.83 100.24 105.20 C 100.22 139.13 100.20 173.06 100.21 206.99 C 83.63 207.01 67.04 206.99 50.46 207.00 C 46.70 186.12 44.08 164.42 48.71 143.45 C 49.16 141.93 49.24 139.79 51.10 139.31 C 64.46 133.01 77.22 125.17 87.97 114.98 Z" />
      <path id="side1"  className={`mouse-part ${activeId === 'side1' ? 'active' : ''}`} fill="#000000" opacity="1.00" d=" M 39.50 167.42 C 39.07 179.33 40.53 191.23 42.35 202.98 C 39.53 203.57 36.70 204.13 33.87 204.68 C 32.85 193.06 31.66 181.45 30.68 169.82 C 33.66 169.15 36.60 168.37 39.50 167.42 Z" />
      <path id="side2"   className={`mouse-part ${activeId === 'side2' ? 'active' : ''}`} fill="#000000" opacity="1.00" d=" M 34.63 210.84 C 37.42 209.78 40.15 208.54 43.08 207.91 C 44.21 219.64 47.01 231.14 49.95 242.53 C 47.26 243.43 44.53 244.25 41.79 244.97 C 39.37 233.60 36.96 222.23 34.63 210.84 Z" />
      <path fill="#000000" opacity="1.00" d=" M 50.38 208.01 C 66.99 207.99 83.60 208.00 100.22 208.01 C 100.29 215.31 100.10 222.61 100.29 229.91 C 100.19 231.24 101.85 232.01 103.00 231.93 C 114.01 231.97 125.03 231.94 136.05 231.95 C 137.24 231.95 139.39 231.76 139.43 230.19 C 139.66 222.80 139.38 215.40 139.42 208.01 C 156.06 207.97 172.69 208.03 189.33 207.98 C 187.92 215.39 186.33 222.76 184.14 229.98 C 183.77 231.25 183.21 232.47 182.33 233.47 C 173.01 244.13 163.76 254.86 154.56 265.63 C 133.01 265.64 111.46 265.58 89.91 265.66 C 78.74 254.28 67.23 243.22 56.22 231.71 C 53.21 224.14 52.01 215.96 50.38 208.01 Z" />
      <path fill="#000000" opacity="1.00" d=" M 56.42 241.02 C 65.68 251.18 75.88 260.48 85.37 270.42 C 92.77 295.77 98.97 321.49 106.21 346.90 C 89.16 343.74 73.27 334.25 62.62 320.52 C 54.06 309.87 48.91 296.95 45.55 283.82 C 45.09 281.83 45.34 279.76 45.88 277.82 C 49.54 265.60 53.05 253.31 56.42 241.02 Z" />
      <path fill="#000000" opacity="1.00" d=" M 160.21 269.11 C 167.96 260.10 175.82 251.18 183.46 242.08 C 186.87 254.41 190.51 266.70 194.00 279.02 C 195.01 283.43 192.84 287.66 191.69 291.83 C 186.60 309.05 176.27 325.14 161.26 335.29 C 154.56 340.12 146.79 343.20 139.01 345.80 C 141.06 336.09 144.18 326.65 146.59 317.02 C 149.88 303.94 153.75 291.01 156.98 277.91 C 157.96 274.96 158.13 271.56 160.21 269.11 Z" />
      <path fill="#000000" opacity="1.00" d=" M 93.50 272.82 C 112.67 272.88 131.85 272.84 151.02 272.85 C 144.66 297.73 137.86 322.53 131.22 347.35 C 125.35 348.26 119.39 348.53 113.47 348.04 C 107.04 322.90 100.07 297.92 93.50 272.82 Z" />
      </g>
      <g id="#fcfcfcff">
      <path id="middle"  className={`mouse-part ${activeId === 'middle' ? 'active' : ''}`} fill="#fcfcfc" opacity="1.00" d=" M 114.63 157.89 C 114.55 154.85 117.42 153.25 120.00 152.62 C 122.50 153.36 124.98 155.06 125.13 157.91 C 125.31 164.62 125.19 171.35 125.20 178.07 C 125.45 181.61 122.37 184.76 118.81 184.44 C 116.62 183.47 114.49 181.68 114.61 179.03 C 114.54 171.99 114.55 164.93 114.63 157.89 Z" />
      </g>
      </svg>

  );

  const handleDocumentation = () => {
    window.open('https://makcu.gitbook.io/makcu', '_blank');
  };

  const handleDiscord = () => {
    window.open('https://discord.com/invite/tQMJMuV5', '_blank');
  };


  return (
    <div className="cyber-console">
      <div className="control-panel">
        <div className="cyber-button-container-main">
          <label style={{marginTop: '2vh'}}>Version:</label>
          <select className="cyber-select" value={version} onChange={e => setVersion(e.target.value)}>
            <option>3.0</option>
            <option>3.2</option>
          </select>
          <button className="cyber-button" onClick={connectSerial}  style={{display: 'flex', alignItems: 'center', gap: '0.5vw'}}>
            <svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="1"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-plug-connected"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5z" /><path d="M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5z" /><path d="M3 21l2.5 -2.5" /><path d="M18.5 5.5l2.5 -2.5" /><path d="M10 11l-2 2" /><path d="M13 14l-2 2" /></svg>
            Connect</button>
          <button className="cyber-button" onClick={testAim} disabled={!writerRef.current} style={{display: 'flex', alignItems: 'center', gap: '0.5vw'}}>
            <svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="1"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-focus-2"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><circle cx="12" cy="12" r=".5" fill="currentColor" /><path d="M12 12m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /><path d="M12 3l0 2" /><path d="M3 12l2 0" /><path d="M12 19l0 2" /><path d="M19 12l2 0" /></svg>
            Test Aim
          </button>
          <button className="cyber-button" onClick={startButtonTest} disabled={!writerRef.current || isTestingButtons} style={{display: 'flex', alignItems: 'center', gap: '0.5vw'}}>
           <svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="1"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-mouse-2"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 3m0 4a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v10a4 4 0 0 1 -4 4h-4a4 4 0 0 1 -4 -4z" /><path d="M12 3v7" /><path d="M6 10h12" /></svg>
            Test Buttons
          </button>
          <button className="cyber-button" onClick={runBenchmark} disabled={!writerRef.current || isBenchmarking}  style={{display: 'flex', alignItems: 'center', gap: '0.5vw'}}>
          <svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="1"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-brand-speedtest"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5.636 19.364a9 9 0 1 1 12.728 0" /><path d="M16 9l-4 4" /></svg>
            Benchmark
          </button>
        </div>
        <div className="cyber-button-container">
          <button className="cyber-button" onClick={downloadCH343Driver} style={{display: 'flex', alignItems: 'center', gap: '0.5vw'}}>
            <svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="1"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-cpu"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 5m0 1a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1z" /><path d="M9 9h6v6h-6z" /><path d="M3 10h2" /><path d="M3 14h2" /><path d="M10 3v2" /><path d="M14 3v2" /><path d="M21 10h-2" /><path d="M21 14h-2" /><path d="M14 21v-2" /><path d="M10 21v-2" /></svg>
            CH343 Driver</button>
          <button className="cyber-button" onClick={downloadAIOTool} style={{display: 'flex', alignItems: 'center', gap: '0.5vw'}}>
          <svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="1"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-tool"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5" /></svg>
            AIOTool</button>
          <button className="cyber-button" onClick={handleDocumentation} style={{display: 'flex', alignItems: 'center', gap: '0.5vw'}}>
            <svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="1"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-clipboard-text"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2" /><path d="M9 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z" /><path d="M9 12h6" /><path d="M9 16h6" /></svg>
            Docs</button>
          <button className="cyber-button" onClick={handleDiscord} style={{display: 'flex', alignItems: 'center', gap: '0.5vw'}}>
           <svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="1"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-brand-discord"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M8 12a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" /><path d="M14 12a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" /><path d="M15.5 17c0 1 1.5 3 2 3c1.5 0 2.833 -1.667 3.5 -3c.667 -1.667 .5 -5.833 -1.5 -11.5c-1.457 -1.015 -3 -1.34 -4.5 -1.5l-.972 1.923a11.913 11.913 0 0 0 -4.053 0l-.975 -1.923c-1.5 .16 -3.043 .485 -4.5 1.5c-2 5.667 -2.167 9.833 -1.5 11.5c.667 1.333 2 3 3.5 3c.5 0 2 -2 2 -3" /><path d="M7 16.5c3.5 1 6.5 1 10 0" /></svg>
            Discord</button>
        </div>
      </div>

      <div className="main-panel">
      <div id="aim-zone" className="cyber-aim-zone" onClick={handleAimClick}>
        {isTestingAim && !isTestingButtons && currentIndex < aimTargets.length && (
          <>
          <div className="cyber-center" />
          <div className="cyber-circle red" style={{ top: `${aimTargets[currentIndex].y}px`, left: `${aimTargets[currentIndex].x}px` }} />
          </>
        )}


        {isTestingButtons && !isTestingAim && (
          <div className="mouse-wrapper">
            <MouseSVG activeId={activeButton} />
          </div>
        )}

        {isBenchmarking && aimTargets.length > 0 && (
          <div
            className="benchmark-flash"
            style={{
              top: `${aimTargets[benchmarkProgress - 1]?.y || 0}px`,
              left: `${aimTargets[benchmarkProgress - 1]?.x || 0}px`
            }}
          />
        )}
        {isBenchmarking && (
          <div className="benchmark-counter">
            {benchmarkProgress} / 100
          </div>
        )}
        {!isBenchmarking && benchmarkProgress === 50 && (
          <div className="benchmark-done">✔ Benchmark Completed</div>
        )}





      </div>


        <div className="info-panel">
          <h3 style={{fontSize: '1.6rem', marginLeft: '1vw'}}>Device Info</h3>
          {deviceInfo ? (
            <ul style={{fontSize: '1.2rem'}}>
              <li>Baud: {baudRate}</li>
              <li>DataBits: {deviceInfo.dataBits}</li>
              <li>StopBits: {deviceInfo.stopBits}</li>
              <li>Uptime: {uptime}s</li>
              <li>Bytes sent: {bytesSent}</li>
              <li>Bytes recv: {bytesReceived}</li>
            </ul>
          ) : (<p style={{fontSize: '1.2rem', marginLeft: '1vw'}}>No device</p>)}

          <pre ref={logRef} className="cyber-log">{log}</pre>

          <div className="command-input-panel">
            <input
              className="cyber-input"
              value={commandInput}
              onChange={e => setCommandInput(e.target.value)}
              onKeyDown={e => e.key==='Enter' && handleSendInput()}
              placeholder="Enter command..."
            />
            <button className="cyber-button" onClick={handleSendInput} disabled={!writerRef.current||!commandInput.trim()}>Send</button>
          </div>
        </div>
      </div>
      <div className="test-buttons">
      <div className="madewithlove">
        <span>Made with </span>
        <span style={{color:'white'}}>
            <svg  xmlns="http://www.w3.org/2000/svg"  width="18"  height="18"  viewBox="0 0 24 24"  fill="currentColor"  class="icon icon-tabler icons-tabler-filled icon-tabler-heart"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6.979 3.074a6 6 0 0 1 4.988 1.425l.037 .033l.034 -.03a6 6 0 0 1 4.733 -1.44l.246 .036a6 6 0 0 1 3.364 10.008l-.18 .185l-.048 .041l-7.45 7.379a1 1 0 0 1 -1.313 .082l-.094 -.082l-7.493 -7.422a6 6 0 0 1 3.176 -10.215z" /></svg>
        </span>
        <span>by <a href="#">bitc0de</a></span>
           
      </div>

</div>

    </div>
  );
}
