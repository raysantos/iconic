// Audit fixes.
import { auditShape } from '../audit';
import { edit } from './edit';
import { byIdAll } from './style';

// ---- Audit fixes ------------------------------------------------------------

export function fixAuditIssue(sid: string, index: number) {
  const s = byIdAll(sid);
  if (!s || s.type !== 'bezier') return;
  const issue = auditShape(s)[index];
  if (issue) edit(() => issue.fix(s));
}

// Fix everything, re-checking after each fix (some fixes add or remove points).
export function fixAllAudit(sids: string[]) {
  edit(() => {
    for (const sid of sids) {
      const s = byIdAll(sid);
      if (!s || s.type !== 'bezier') continue;
      for (let guard = 0; guard < 100; guard++) {
        const next = auditShape(s)[0];
        if (!next) break;
        next.fix(s);
      }
    }
  });
}
