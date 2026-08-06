import type {
  MonopolyCardId,
  MonopolyEndReason,
  MonopolyGroup,
  MonopolyOptionKey,
  MonopolyPhase,
  MonopolyTileId,
} from 'shared';

/**
 * 兩套偽裝外觀的大富翁詞彙。
 *
 * 40 格棋盤沒辦法像一張牌那樣用兩三個字帶過，所以整張表放在這裡，
 * vscode.ts 與 terminal.ts 只負責引用 —— 兩個檔案本來就已經夠長了。
 *
 * 偽裝策略：
 * - VS Code：棋盤讀起來是 Explorer 的檔案樹，色組是目錄，房子是 Problems 徽章。
 * - 終端機：棋盤讀起來是 `ls -l` 的輸出，色組是掛載點，房子是檔名尾綴。
 */

// ---------------------------------------------------------------------------
// VS Code
// ---------------------------------------------------------------------------

export const VSCODE_GROUP: Record<MonopolyGroup, string> = {
  brown: 'src/utils',
  lightBlue: 'src/hooks',
  pink: 'src/components',
  orange: 'src/pages',
  red: 'src/state',
  yellow: 'src/server',
  green: 'src/core',
  blue: 'src/runtime',
  railroad: '.github/workflows',
  utility: 'config',
};

export const VSCODE_TILE: Record<MonopolyTileId, string> = {
  go: 'package.json',
  jail: '.git/HEAD',
  freeParking: 'node_modules/',
  goToJail: 'hooks/pre-commit',
  chance1: 'TODO.md',
  chance2: 'TODO.md',
  chance3: 'TODO.md',
  fate1: 'CHANGELOG.md',
  fate2: 'CHANGELOG.md',
  fate3: 'CHANGELOG.md',
  incomeTax: 'coverage/',
  luxuryTax: 'dist/',

  brown1: 'src/utils/date.ts',
  brown2: 'src/utils/uuid.ts',
  lightBlue1: 'src/hooks/useAuth.ts',
  lightBlue2: 'src/hooks/useFetch.ts',
  lightBlue3: 'src/hooks/useStore.ts',
  pink1: 'src/components/Button.tsx',
  pink2: 'src/components/Modal.tsx',
  pink3: 'src/components/Table.tsx',
  orange1: 'src/pages/Login.tsx',
  orange2: 'src/pages/Home.tsx',
  orange3: 'src/pages/Admin.tsx',
  red1: 'src/state/session.ts',
  red2: 'src/state/cache.ts',
  red3: 'src/state/router.ts',
  yellow1: 'src/server/api.ts',
  yellow2: 'src/server/auth.ts',
  yellow3: 'src/server/db.ts',
  green1: 'src/core/engine.ts',
  green2: 'src/core/scheduler.ts',
  green3: 'src/core/kernel.ts',
  blue1: 'src/runtime/vm.ts',
  blue2: 'src/runtime/jit.ts',
  rail1: '.github/workflows/lint.yml',
  rail2: '.github/workflows/test.yml',
  rail3: '.github/workflows/build.yml',
  rail4: '.github/workflows/deploy.yml',
  utility1: 'config/eslint.json',
  utility2: 'config/tsconfig.json',
};

export const VSCODE_CARD: Record<MonopolyCardId, string> = {
  chanceGo: 'Reset to origin — budget refreshed',
  chanceBlue2: 'Jump to src/runtime/jit.ts',
  chanceLightBlue3: 'Jump to src/hooks/useStore.ts',
  chanceNearestRail: 'Jump to the next workflow',
  chanceNearestUtility: 'Jump to the next config file',
  chanceDividend: 'Quarterly credit +50',
  chanceJailCard: 'Force-push token granted',
  chanceBack3: 'Revert three commits',
  chanceGoToJail: 'Pre-commit hook rejected you',
  chanceRepairs: 'Refactor cost: 25 per fix, 100 per rewrite',
  chanceSpeeding: 'Lint violation −15',
  chanceRail1: 'Jump to .github/workflows/lint.yml',
  chanceChairman: 'You are on-call — pay every member 50',
  chanceLoan: 'Infra rebate +150',
  chanceCrossword: 'Bug bounty +100',
  chanceOrange2: 'Jump to src/pages/Home.tsx',

  fateGo: 'Reset to origin — budget refreshed',
  fateBankError: 'Billing correction +200',
  fateDoctor: 'Incident response −50',
  fateStock: 'Cost saving +50',
  fateJailCard: 'Force-push token granted',
  fateGoToJail: 'Audit failed — blocked',
  fateOpening: 'Launch party — collect 50 from each member',
  fateTaxRefund: 'Credit rollover +20',
  fateBirthday: 'Anniversary — each member sends you 10',
  fateInsurance: 'SLA credit +100',
  fateHospital: 'Postmortem cost −100',
  fateSchool: 'Training cost −50',
  fateConsultancy: 'Consulting fee +25',
  fateStreetRepairs: 'Migration cost: 40 per fix, 115 per rewrite',
  fateBeauty: 'Runner-up prize +10',
  fateInheritance: 'Legacy handover +100',
};

export const VSCODE_OPTION: Record<MonopolyOptionKey, string> = {
  startCash: 'Initial budget',
  lastStanding: 'Run until one member remains',
  roundLimit: 'Max iterations',
  targetNetWorth: 'Target score',
  auctions: 'Auction unclaimed files',
  allowTrades: 'Allow transfers',
  freeParkingPot: 'Pool refunds',
};

export const VSCODE_PHASE: Record<MonopolyPhase, string> = {
  roll: 'dispatch',
  jail: 'blocked',
  buy: 'claim',
  auction: 'bidding',
  trade: 'review',
  debt: 'overdue',
  manage: 'refactor',
};

export const VSCODE_END: Record<MonopolyEndReason, string> = {
  lastStanding: 'only one member left',
  roundLimit: 'iteration limit reached',
  targetNetWorth: 'target score reached',
  abandoned: 'not enough members',
};

/** 房子＝Problems 面板的徽章，飯店＝整份重寫。 */
export function vscodeHouses(n: number): string {
  if (n <= 0) return '';
  return n >= 5 ? '⛔' : `⚠${n}`;
}

// ---------------------------------------------------------------------------
// 終端機
// ---------------------------------------------------------------------------

export const TERMINAL_GROUP: Record<MonopolyGroup, string> = {
  brown: 'tmp',
  lightBlue: 'var',
  pink: 'etc',
  orange: 'usr',
  red: 'opt',
  yellow: 'srv',
  green: 'lib',
  blue: 'bin',
  railroad: 'dev',
  utility: 'proc',
};

export const TERMINAL_TILE: Record<MonopolyTileId, string> = {
  go: '~/',
  jail: 'var/lock',
  freeParking: 'dev/null',
  goToJail: 'sbin/halt',
  chance1: 'usr/bin/rand',
  chance2: 'usr/bin/rand',
  chance3: 'usr/bin/rand',
  fate1: 'usr/bin/env',
  fate2: 'usr/bin/env',
  fate3: 'usr/bin/env',
  incomeTax: 'var/tmp/quota',
  luxuryTax: 'var/tmp/audit',

  brown1: 'tmp/a.lock',
  brown2: 'tmp/b.lock',
  lightBlue1: 'var/log',
  lightBlue2: 'var/cache',
  lightBlue3: 'var/spool',
  pink1: 'etc/hosts',
  pink2: 'etc/fstab',
  pink3: 'etc/passwd',
  orange1: 'usr/share',
  orange2: 'usr/local',
  orange3: 'usr/include',
  red1: 'opt/agent',
  red2: 'opt/relay',
  red3: 'opt/broker',
  yellow1: 'srv/http',
  yellow2: 'srv/ftp',
  yellow3: 'srv/git',
  green1: 'lib/libc.so',
  green2: 'lib/libssl.so',
  green3: 'lib/libpthread.so',
  blue1: 'bin/bash',
  blue2: 'bin/init',
  rail1: 'dev/tty0',
  rail2: 'dev/tty1',
  rail3: 'dev/tty2',
  rail4: 'dev/tty3',
  utility1: 'proc/cpuinfo',
  utility2: 'proc/meminfo',
};

export const TERMINAL_CARD: Record<MonopolyCardId, string> = {
  chanceGo: 'cd ~ && quota +200',
  chanceBlue2: 'cd bin/init',
  chanceLightBlue3: 'cd var/spool',
  chanceNearestRail: 'cd $(next dev/*)',
  chanceNearestUtility: 'cd $(next proc/*)',
  chanceDividend: 'quota +50',
  chanceJailCard: 'sudo token acquired',
  chanceBack3: 'cd ../../..',
  chanceGoToJail: 'permission denied — held',
  chanceRepairs: 'fsck: 25/inode, 100/volume',
  chanceSpeeding: 'rate limit −15',
  chanceRail1: 'cd dev/tty0',
  chanceChairman: 'on-call: pay 50 to each user',
  chanceLoan: 'refund +150',
  chanceCrossword: 'bounty +100',
  chanceOrange2: 'cd usr/local',

  fateGo: 'cd ~ && quota +200',
  fateBankError: 'accounting fix +200',
  fateDoctor: 'incident −50',
  fateStock: 'savings +50',
  fateJailCard: 'sudo token acquired',
  fateGoToJail: 'audit failed — held',
  fateOpening: 'collect 50 from each user',
  fateTaxRefund: 'rollover +20',
  fateBirthday: 'each user sends you 10',
  fateInsurance: 'sla credit +100',
  fateHospital: 'postmortem −100',
  fateSchool: 'training −50',
  fateConsultancy: 'consulting +25',
  fateStreetRepairs: 'migrate: 40/inode, 115/volume',
  fateBeauty: 'runner-up +10',
  fateInheritance: 'handover +100',
};

export const TERMINAL_OPTION: Record<MonopolyOptionKey, string> = {
  startCash: 'initial quota',
  lastStanding: 'run until one user left',
  roundLimit: 'max cycles',
  targetNetWorth: 'target usage',
  auctions: 'auction free inodes',
  allowTrades: 'allow chown',
  freeParkingPot: 'pool reclaimed space',
};

export const TERMINAL_PHASE: Record<MonopolyPhase, string> = {
  roll: 'exec',
  jail: 'held',
  buy: 'alloc',
  auction: 'bid',
  trade: 'chown',
  debt: 'oom',
  manage: 'tune',
};

export const TERMINAL_END: Record<MonopolyEndReason, string> = {
  lastStanding: 'one user left',
  roundLimit: 'cycle limit',
  targetNetWorth: 'target usage reached',
  abandoned: 'not enough users',
};

/** 房子＝檔名尾綴的星號，飯店＝一個井字。 */
export function terminalHouses(n: number): string {
  if (n <= 0) return '';
  return n >= 5 ? '#' : '*'.repeat(n);
}
