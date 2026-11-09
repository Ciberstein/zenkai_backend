const R      = '\x1b[0m';
const BLUE   = '\x1b[34m';
const CYAN   = '\x1b[36m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const DIM    = '\x1b[2m';
const BOLD   = '\x1b[1m';

const lbl  = (s) => `${BLUE}${s}${R}`;
const grn  = (s) => `${GREEN}${s}${R}`;
const ylw  = (s) => `${YELLOW}${s}${R}`;
const red  = (s) => `${RED}${s}${R}`;
const cyn  = (s) => `${CYAN}${BOLD}${s}${R}`;
const dim  = (s) => `${DIM}${s}${R}`;

// ─── Status / init messages ──────────────────────────────────────────────────
const ok    = (label, value) => console.log(lbl(`${label}:`), grn(String(value)));
const warn  = (label, value) => console.log(lbl(`${label}:`), ylw(String(value)));
const error = (label, value) => console.error(lbl(`${label}:`), red(String(value)));

// ─── Operational / runtime messages ─────────────────────────────────────────
const info    = (module, msg) => console.log(lbl(`[${module}]`), msg);
const success = (module, msg) => console.log(lbl(`[${module}]`), `${grn('✓')} ${msg}`);
const fail    = (module, msg) => console.error(lbl(`[${module}]`), `${red('✗')} ${msg}`);

// ─── ASCII Banner ─────────────────────────────────────────────────────────────
const banner = () => {
  const art = [
    ' ███████╗███████╗███╗   ██╗██╗  ██╗ █████╗ ██╗',
    ' ╚══███╔╝██╔════╝████╗  ██║██║ ██╔╝██╔══██╗██║',
    '   ███╔╝ █████╗  ██╔██╗ ██║█████╔╝ ███████║██║',
    '  ███╔╝  ██╔══╝  ██║╚██╗██║██╔═██╗ ██╔══██║██║',
    ' ███████╗███████╗██║ ╚████║██║  ██╗██║  ██║██║',
    ' ╚══════╝╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝',
  ];
  console.log('');
  art.forEach((line) => console.log(cyn(line)));
  console.log(dim('  Anime Streaming Platform  ·  By Cyberstein'));
  console.log('');
};

// ─── Seeder table ─────────────────────────────────────────────────────────────
// rows = [{ group: 'APP', name: 'Languages', status: 'SYNC' | 'EXISTING' | 'ERROR' }]
const table = (rows) => {
  const C1 = 32; // name column (inner)
  const C2 = 10; // status column (inner)

  const h = '═';
  const top    = lbl(`╔${h.repeat(C1 + 2)}╦${h.repeat(C2 + 2)}╗`);
  const mid    = lbl(`╠${h.repeat(C1 + 2)}╬${h.repeat(C2 + 2)}╣`);
  const bottom = lbl(`╚${h.repeat(C1 + 2)}╩${h.repeat(C2 + 2)}╝`);

  const header = `${lbl('║')} ${'SEEDER'.padEnd(C1)} ${lbl('║')} ${'STATUS'.padEnd(C2)} ${lbl('║')}`;

  const statusFmt = (s) => {
    const p = String(s).padEnd(C2);
    if (s === 'SYNC')     return grn(p);
    if (s === 'EXISTING') return ylw(p);
    return red(p);
  };

  // Group rows preserving insertion order
  const groups = [];
  const map = Object.create(null);
  for (const row of rows) {
    if (!map[row.group]) {
      map[row.group] = [];
      groups.push({ label: row.group, items: map[row.group] });
    }
    map[row.group].push(row);
  }

  const lines = [top, header];

  for (const group of groups) {
    lines.push(mid);
    lines.push(`${lbl('║')} ${lbl(group.label.padEnd(C1))} ${lbl('║')} ${''.padEnd(C2)} ${lbl('║')}`);
    for (const row of group.items) {
      const name = `  ${row.name}`.padEnd(C1);
      lines.push(`${lbl('║')} ${name} ${lbl('║')} ${statusFmt(row.status)} ${lbl('║')}`);
    }
  }

  lines.push(bottom);
  console.log('');
  lines.forEach((line) => console.log(line));
  console.log('');
};

module.exports = { ok, warn, error, info, success, fail, banner, table };
