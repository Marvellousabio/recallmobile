import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { PlanTask } from '@/db/exams';

export function useTaskLabel() {
  const { t } = useTranslation();
  return (task: Pick<PlanTask, 'kind' | 'title'>) =>
    task.kind === 'weak' ? t('plan.weak') : task.kind === 'mock' ? t('plan.mock') : t(`plan.${task.kind}`, { title: task.title });
}

/** Opens the screen that does the task; that screen marks it done on finish. */
export function openTask(task: PlanTask, courseId: string) {
  const params = { taskId: task.id };
  switch (task.kind) {
    case 'learn':
      return router.push({ pathname: '/review', params: { ...params, lectureId: task.ref_id! } });
    case 'quiz':
    case 'past':
      return router.push({ pathname: '/quiz', params: { ...params, lectureId: task.ref_id! } });
    case 'weak':
      return router.push({ pathname: '/review', params: { ...params, courseId, mode: 'weak' } });
    case 'mock':
      return router.push({ pathname: '/quiz', params: { ...params, courseId } });
  }
}
