import type { TFunction } from 'i18next';

import { GroupError } from '@/lib/groups';

export function groupErrorText(e: unknown, t: TFunction): string {
  if (e instanceof GroupError) {
    return {
      'signed-out': t('groups.signIn'),
      offline: t('groups.offline'),
      'bad-code': t('groups.badCode'),
      'not-uploaded': t('groups.notUploaded'),
      empty: t('groups.nothing'),
    }[e.code];
  }
  const msg = String((e as Error)?.message ?? '');
  if (/network|fetch/i.test(msg)) return t('groups.offline');
  console.warn('[groups]', e);
  return t('groups.failed');
}
