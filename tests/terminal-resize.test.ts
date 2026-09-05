// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { expect, test } from "bun:test";
import { Terminal } from "@xterm/xterm";

const history = Array.from({ length: 100 }, (_, index) => `history ${index}\r\n`).join("");
const write = (terminal: Terminal, data: string) => new Promise<void>((resolve) => terminal.write(data, resolve));

test("growing a terminal preserves a TUI prompt and footer near the bottom", async () => {
  const terminal = new Terminal({ cols: 80, rows: 27 });
  try {
    await write(terminal, `${history}prompt> \r\nfooter\r\nstatus\r\n\x1b[3A`);
    const buffer = terminal.buffer.active;
    const cursorLine = buffer.baseY + buffer.cursorY;
    const cursorOffset = terminal.rows - buffer.cursorY;
    terminal.resize(80, 53);
    expect(terminal.rows - buffer.cursorY).toBe(cursorOffset);
    expect(buffer.baseY + buffer.cursorY).toBe(cursorLine);
    expect(buffer.getLine(buffer.baseY)?.translateToString(true)).toBe("history 51");
    expect(buffer.getLine(buffer.baseY + 51)?.translateToString(true)).toBe("status");
    expect(buffer.getLine(buffer.baseY + 52)?.translateToString(true)).toBe("");
    await write(terminal, "\rupdated> ");
    expect(buffer.getLine(cursorLine)?.translateToString(true)).toBe("updated> ");
  } finally {
    terminal.dispose();
  }
});

test("growing a cleared shell keeps its prompt at the top", async () => {
  const terminal = new Terminal({ cols: 80, rows: 27 });
  try {
    await write(terminal, `${history}\x1b[2J\x1b[Hprompt> `);
    const base = terminal.buffer.active.baseY;
    terminal.resize(80, 53);
    expect(terminal.buffer.active.baseY).toBe(base);
    expect(terminal.buffer.active.cursorY).toBe(0);
  } finally {
    terminal.dispose();
  }
});

test("growing an alternate screen keeps its cursor and contents", async () => {
  const terminal = new Terminal({ cols: 80, rows: 27 });
  try {
    await write(terminal, `${history}\x1b[?1049h\x1b[10;1Hprompt\r\nfooter\x1b[1A`);
    terminal.resize(80, 53);
    expect(terminal.buffer.active.type).toBe("alternate");
    expect(terminal.buffer.active.baseY).toBe(0);
    expect(terminal.buffer.active.cursorY).toBe(9);
    expect(terminal.buffer.active.getLine(10)?.translateToString(true)).toBe("footer");
  } finally {
    terminal.dispose();
  }
});

test("growing after reflow with no scrollback scans only existing lines", async () => {
  const terminal = new Terminal({ cols: 99, rows: 46, scrollback: 0 });
  try {
    await write(terminal, `${"line ".repeat(30)}\r\nprompt> \r\nfooter\r\n\x1b[2A`);
    terminal.resize(4, 27);
    await write(terminal, "\x1b[26;1H");
    terminal.resize(4, 53);
    expect(terminal.rows).toBe(53);
    await write(terminal, "ok");
    const buffer = terminal.buffer.active;
    expect(buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true)).toStartWith("ok");
  } finally {
    terminal.dispose();
  }
});
