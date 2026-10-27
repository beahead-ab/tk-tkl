import {SerialGateway} from './serial-gateway.mjs';

// Bara kanoniska COM-namn får nå Windows. Inga filnamn eller särskilda Windows-enheter.
export const isComPort = value => typeof value === 'string' && /^COM[1-9]\d{0,3}$/i.test(value);

export async function loadSerialPort() {
  try { return (await import('serialport')).SerialPort; }
  catch { throw Error('Windows-stödet för COM-portar saknas eller kan inte laddas. Installera om TKL med installationsskriptet.'); }
}

export async function listWindowsSerialDevices(load = loadSerialPort) {
  const SerialPort = await load();
  const ports = await SerialPort.list();
  return ports.filter(p => isComPort(p.path)).map(p => ({
    path: p.path.toUpperCase(),
    label: [p.path.toUpperCase(), p.friendlyName || p.manufacturer || p.pnpId].filter(Boolean).join(' · ')
  })).sort((a,b) => Number(a.path.slice(3)) - Number(b.path.slice(3)));
}

export function windowsSerialError(device, error) {
  const message = String(error?.message || error);
  if (/access denied|access is denied|permission|busy|cannot lock/i.test(message))
    return `${device} kan inte öppnas. Stäng JMRI och andra program som kan använda porten och försök igen. (${message})`;
  return `${device}: ${message}. Kontrollera att kortet är parat och att dess utgående Bluetooth-COM-port är vald.`;
}

// Windows kör Node direkt. TCP öppnas först när COM-porten är öppen. SerialGateway kräver fortfarande ett
// fullständigt eko från kortet för SENT OK; varken öppning eller lyckad write är en kvittens på en order.
export function startWindowsGateway({device, port, SerialPort, openTimeoutMs = 20000, onError = () => {}}) {
  if (!isComPort(device)) throw Error('Ange kortets utgående Bluetooth-COM-port, till exempel COM7.');
  device = device.toUpperCase();
  const serial = new SerialPort({path: device, baudRate: 115200, dataBits: 8, stopBits: 1,
    parity: 'none', rtscts: false, xon: false, xoff: false, autoOpen: false});
  let stopped = false, timer, resolveReady, rejectReady, settled = false;
  const ready = new Promise((resolve,reject) => { resolveReady = resolve; rejectReady = reject; });
  const closeSerial = () => { if (serial.isOpen) serial.close(() => {}); };
  const gateway = new SerialGateway({
    writeBytes(bytes) {
      if (stopped || !serial.isOpen || serial.writableLength + bytes.length > 65536) throw Error('COM-porten är inte tillgänglig.');
      serial.write(bytes, error => { if (error) fail(error); });
    },
    closeSerial() {
      stopped = true; clearTimeout(timer); closeSerial();
      if (!settled) { settled = true; rejectReady(Error('COM-anslutningen avbröts.')); }
    }
  });
  function fail(error) {
    if (stopped) return;
    const message = windowsSerialError(device, error);
    if (!settled) { settled = true; rejectReady(Error(message)); }
    onError(message); gateway.fail(message);
  }
  serial.on('data', bytes => gateway.push(bytes));
  serial.on('error', fail);
  serial.on('close', () => fail(Error('Bluetooth-förbindelsen bröts')));
  timer = setTimeout(() => fail(Error('Tidsgränsen för att öppna COM-porten överskreds')), openTimeoutMs);
  serial.open(error => {
    if (stopped) { closeSerial(); return; }
    if (error) { fail(error); return; }
    clearTimeout(timer);
    gateway.listen(port).then(actualPort => {
      // Om anslutningen stängdes medan TCP-porten bands får ingen lyssnare bli kvar.
      if (stopped) { gateway.server.close(); return; }
      settled = true; resolveReady(actualPort);
    }).catch(fail);
  });
  return {gateway, serial, ready};
}
