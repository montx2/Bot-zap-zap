// Trava de instância única.
//
// Duas cópias do bot usando a MESMA sessão (data/auth) é a causa nº 1 de:
//   • "stream:error conflict / type: replaced" (uma derruba a outra em loop);
//   • "Bad MAC" / "No matching sessions found" (as duas gravam chaves Signal diferentes);
//   • comandos e figurinhas que "não respondem" ou demoram minutos.
// Com a trava, a segunda cópia avisa e sai sem encostar na sessão.
import fs from 'node:fs';
import path from 'node:path';

const isAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
};

// Protege contra PID reaproveitado pelo Android depois de um kill: só conta se for o bot.
const looksLikeBot = (pid) => {
  try { return /main\.js/.test(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')); }
  catch { return true; } // sem /proc legível: assume que é o bot
};

const readPid = (file) => {
  try { return Number.parseInt(fs.readFileSync(file, 'utf8'), 10) || 0; } catch { return 0; }
};

/**
 * @returns {{ok:true}|{ok:false,pid:number}}
 */
export function acquireInstanceLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(file, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
      const release = () => { try { if (readPid(file) === process.pid) fs.unlinkSync(file); } catch {} };
      process.on('exit', release);
      return { ok: true, release };
    } catch (e) {
      if (e?.code !== 'EEXIST') return { ok: true, release() {} }; // não conseguiu criar (FS estranho): não bloqueia
      const pid = readPid(file);
      if (pid && pid !== process.pid && isAlive(pid) && looksLikeBot(pid)) return { ok: false, pid };
      try { fs.unlinkSync(file); } catch {} // trava velha (processo morto)
    }
  }
  return { ok: true, release() {} };
}
