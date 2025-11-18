#!/usr/bin/env node
import fs from "fs";
import path from "path";
import archiver from "archiver";

function usageAndExit(msg) {
  if (msg) console.error(msg);
  console.log("Usage: node zip.js <lambda-dir>");
  process.exit(msg ? 1 : 0);
}

export function getFormattedDateTime() {
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const year = now.getFullYear().toString().slice(-2);
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const pad = (num) => num.toString().padStart(2, "0");
  const DD = pad(day);
  const MM = pad(month);
  const YY = year;
  const HR = pad(hours);
  const MN = pad(minutes);

  return `${MM}-${DD}-${YY}_${HR}-${MN}`;
}

const arg = process.argv[2];
if (!arg) usageAndExit("Missing target lambda directory argument.");

const targetDir = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
  usageAndExit(`Target directory not found or not a directory: ${targetDir}`);
}
const dirParts = targetDir.split("\\");
const lastDir = dirParts[dirParts.length - 1];
const dateStamp = getFormattedDateTime();
const outputZip = path.join(targetDir, `${lastDir}.zip`);

function createZip() {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputZip);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(
        `Lambda zip created: ${archive.pointer()} bytes -> ${outputZip}`
      );
      resolve();
    });

    output.on("end", () => {
      console.log("Data has been drained");
    });

    archive.on("warning", (err) => {
      if (err.code === "ENOENT") {
        console.warn("Archiver warning", err);
      } else {
        reject(err);
      }
    });

    archive.on("error", (err) => {
      reject(err);
    });

    archive.pipe(output);

    function addIfExists(fsPath, entryName, isDirectory = false) {
      if (fs.existsSync(fsPath)) {
        if (isDirectory) {
          const dest = entryName === false ? "(root of zip)" : entryName;
          console.log(`Adding directory to zip: ${fsPath} -> ${dest}`);
          // If entryName === false, archiver will place the directory contents at the archive root
          archive.directory(fsPath, entryName);
        } else {
          console.log(`Adding file to zip: ${fsPath} -> ${entryName}`);
          archive.file(fsPath, { name: entryName });
        }
      } else {
        console.warn(`Skipping missing path: ${fsPath}`);
      }
    }

    const distPath = path.join(targetDir, "dist");
    const nodeModulesPath = path.join(targetDir, "node_modules");
    const packageJsonPath = path.join(targetDir, "package.json");

    // Add dist contents at the root of the zip (so files like index.js, package.json,
    // and node_modules/* from inside dist end up at the zip root rather than under a dist/ folder)
    addIfExists(distPath, false, true);
    addIfExists(nodeModulesPath, "node_modules", true);
    addIfExists(packageJsonPath, "package.json", false);

    archive.finalize().catch(reject);
  });
}

createZip().catch((err) => {
  console.error("Failed to create zip:", err);
  process.exitCode = 1;
});
