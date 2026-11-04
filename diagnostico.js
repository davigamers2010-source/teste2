const fs = require("fs");

const MAX_BYTES = 10 * 1024 * 1024;
const RETAIN_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_CHARS = 4096;

module.exports = function createDiagnosticWriter(file) {
  return message => {
    let fd;
    try {
      const entry = Buffer.from(
        new Date().toISOString() + "  " + String(message).slice(0, MAX_ENTRY_CHARS) + "\n",
        "utf8"
      );
      try { fd = fs.openSync(file, "r+"); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        fd = fs.openSync(file, "w+");
      }
      const size = fs.fstatSync(fd).size;
      if (size + entry.length > MAX_BYTES) {
        const tail = Buffer.alloc(Math.min(size, RETAIN_BYTES - entry.length));
        fs.readSync(fd, tail, 0, tail.length, size - tail.length);
        const newline = tail.indexOf(0x0a);
        const retained = newline < 0 ? Buffer.alloc(0) : tail.subarray(newline + 1);
        fs.ftruncateSync(fd, 0);
        fs.writeSync(fd, retained, 0, retained.length, 0);
      }
      fs.writeSync(fd, entry, 0, entry.length, fs.fstatSync(fd).size);
    } catch (error) {
      console.error("Não foi possível gravar o diagnóstico:", error);
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); }
        catch (error) { console.error("Não foi possível fechar o diagnóstico:", error); }
      }
    }
  };
};
