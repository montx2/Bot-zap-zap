import { jidNormalizedUser } from '@whiskeysockets/baileys';

export function ownerJid(sock) {
  const id = sock?.user?.id || sock?.user?.lid;
  if (!id) throw new Error('Conta ainda não autenticada');
  try { return jidNormalizedUser(id); } catch { return id; }
}

export function ownerIds(sock) {
  const values = [sock?.user?.id, sock?.user?.lid, sock?.authState?.creds?.me?.id, sock?.authState?.creds?.me?.lid].filter(Boolean);
  const set = new Set();
  for (const v of values) {
    set.add(v);
    try { set.add(jidNormalizedUser(v)); } catch {}
    const base = String(v).split(':')[0];
    if (base) set.add(base);
  }
  return [...set];
}

export function isOwnerJid(sock, jid) {
  if (!jid) return false;
  const ids = ownerIds(sock);
  if (ids.includes(jid)) return true;
  const a = String(jid).split('@')[0].split(':')[0];
  return ids.some((id) => String(id).split('@')[0].split(':')[0] === a);
}
