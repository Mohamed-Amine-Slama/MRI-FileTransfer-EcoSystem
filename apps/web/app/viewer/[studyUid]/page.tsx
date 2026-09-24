'use client';

import { use } from 'react';
import { Main } from '../../../components/ui';
import { StudyViewer } from '../../../components/viewer/StudyViewer';
import { useT } from '../../../lib/i18n/provider';

export default function ViewerPage({ params }: { params: Promise<{ studyUid: string }> }) {
  const { studyUid } = use(params);
  const t = useT();
  return (
    <Main>
      <h1 className="text-xl font-bold tracking-tight">{t.viewerTitle}</h1>
      <StudyViewer studyUid={studyUid} />
    </Main>
  );
}
