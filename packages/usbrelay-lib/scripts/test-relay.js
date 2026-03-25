import usb from "usb";

const VENDOR_ID = 0x16c0;
const PRODUCT_ID = 0x05df;

const CMD_ON = 0xff;
const CMD_OFF = 0xfd;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hex(buffer) {
  return Array.from(buffer)
    .map((value) => `0x${value.toString(16).padStart(2, "0")}`)
    .join(" ");
}

console.log("=== Step 1: Finding USB device ===");

const device = usb.findByIds(VENDOR_ID, PRODUCT_ID);

if (!device) {
  console.error("ERROR: No USB relay board found (VID 0x16c0, PID 0x05df).");
  console.error("");
  console.error("Check:");
  console.error("  1. USB cable and connection");
  console.error("  2. Zadig: is the libusb driver installed for the relay device?");
  console.error("  3. npm install has completed successfully");
  console.error("");
  console.error("All detected USB devices:");
  usb.getDeviceList().forEach((entry) => {
    const vendorId = `0x${entry.deviceDescriptor.idVendor.toString(16).padStart(4, "0")}`;
    const productId = `0x${entry.deviceDescriptor.idProduct.toString(16).padStart(4, "0")}`;
    console.error(`  VID ${vendorId}  PID ${productId}`);
  });
  process.exit(1);
}

console.log(`Found relay device VID 0x${VENDOR_ID.toString(16)} PID 0x${PRODUCT_ID.toString(16)}`);

device.open();
const iface = device.interface(0);

try {
  if (iface.isKernelDriverActive()) {
    iface.detachKernelDriver();
  }
} catch {
  // Windows: safe to ignore
}

iface.claim();

function getStatus() {
  return new Promise((resolve, reject) => {
    device.controlTransfer(0xa1, 0x01, 0x0100, 0, 8, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    });
  });
}

function sendCommand(cmd, relayNumber) {
  return new Promise((resolve, reject) => {
    const buffer = Buffer.from([cmd, relayNumber, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    device.controlTransfer(0x21, 0x09, 0x0200, 0, buffer, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

try {
  const before = await getStatus();
  console.log("Status before:", hex(before));

  console.log("Turning relay 1 on for 1 second...");
  await sendCommand(CMD_ON, 1);
  await sleep(1000);
  await sendCommand(CMD_OFF, 1);

  const after = await getStatus();
  console.log("Status after:", hex(after));
} finally {
  await new Promise((resolve) => iface.release(resolve));
  device.close();
}