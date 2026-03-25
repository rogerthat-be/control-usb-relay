import { findDevices } from "../src/index.js";

const devices = findDevices();

if (devices.length === 0) {
  console.log("No compatible USB relay device found.");
  process.exit(0);
}

console.log(`Found ${devices.length} compatible device(s):`);
devices.forEach((device, index) => {
  const vendorId = device.vendorId ?? device.deviceDescriptor?.idVendor;
  const productId = device.productId ?? device.deviceDescriptor?.idProduct;
  const product = device.product ?? "USB Relay";
  console.log(
    `${index + 1}. ${product} (VID 0x${vendorId.toString(16)}, PID 0x${productId.toString(16)})`
  );
});