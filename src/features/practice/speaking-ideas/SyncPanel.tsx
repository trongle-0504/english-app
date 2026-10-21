// Library sync: shows how many library items are tagged for Speaking ideas and what a sync would do, and runs it.
// Nothing is tagged automatically — new vocabulary waits here until the Sync button is pressed.
import { Loader2, RefreshCw, Square } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Progress } from '@/components/ui'
import { InfoTip } from '@/features/review/InfoTip'
import { speakingApi } from './api'
import type { useSyncStatus } from './useSyncStatus'

const number = (n: number) => n.toLocaleString('en-US')

export function SyncPanel({ status, error, reload }: ReturnType<typeof useSyncStatus>) {
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setActionError('')
    try {
      await action()
      await reload()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!status) return error ? <p className="text-sm text-rose-600">{error}</p> : null
  const job = status.job
  const running = job?.status === 'running'
  const topic = status.topic
  const toTag = status.pending + status.changed + (topic ? topic.pending + topic.changed : 0)
  const todo = toTag + status.removed + (topic?.removed ?? 0)

  return (
    <Card className="space-y-3 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
          Library sync
          <InfoTip wide>
            Mỗi cụm trong Collocations, Vocabulary và Notes được AI gắn nhãn một lần: dùng cho kiểu câu hỏi nào (nói sở thích, kể hồi nhỏ, nêu ý
            kiến…), hợp chủ đề nào, và có hợp để nói hay chỉ hợp văn viết. Speaking ideas tìm cụm theo các nhãn này. Từ mới thêm vào thư viện chưa
            được gợi ý cho đến khi bạn bấm Sync; Sync chỉ gắn nhãn cho mục mới hoặc mục đã sửa, và xoá nhãn của mục đã bị xoá.
          </InfoTip>
        </h2>
        {running ? (
          <Button size="sm" variant="outline" onClick={() => void act(speakingApi.stopSync)} loading={busy}>
            <Square className="size-3.5" /> Stop
          </Button>
        ) : (
          <Button size="sm" onClick={() => void act(speakingApi.sync)} loading={busy} disabled={!todo || !status.ready}>
            <RefreshCw className="size-4" /> Sync {todo ? `${number(toTag)} items` : ''}
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ['Tagged', `${number(status.tagged)} / ${number(status.library)}`],
          ['New', number(status.pending)],
          ['Edited', number(status.changed)],
          ['Removed', number(status.removed)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="font-semibold text-slate-900 tabular-nums dark:text-white">{value}</dd>
          </div>
        ))}
      </dl>
      {topic ? (
        <p className="flex items-center gap-1.5 text-xs text-slate-500 tabular-nums">
          Topic collocations: đã gắn nhãn {number(topic.tagged)} / {number(topic.total)}
          {topic.pending + topic.changed ? ` · ${number(topic.pending + topic.changed)} chờ gắn nhãn` : ''}
          <InfoTip wide>
            Kho cụm theo chủ đề (phần lớn lấy từ bài mẫu Writing Task 2) cũng được gắn nhãn: giọng văn (nói / cả hai / chỉ viết), độ khó B1–C2 và
            loại (collocation dùng lại được, từ đơn, hay chỉ là mẩu câu của một bài). Speaking ideas bỏ mẩu câu, cụm C2 và cụm chỉ hợp văn viết;
            Writing Review bỏ mẩu câu và cụm C2. Mục chưa gắn nhãn vẫn được dùng như cũ.
          </InfoTip>
        </p>
      ) : null}

      {running && job ? (
        <div className="space-y-1.5">
          <Progress value={(job.done / Math.max(1, job.total)) * 100} />
          <p className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
            <Loader2 className="size-3.5 animate-spin" /> AI đang gắn nhãn {number(job.done)} / {number(job.total)} mục
            {job.failed ? ` · ${number(job.failed)} lỗi (sẽ thử lại ở lần Sync sau)` : ''}. Có thể rời trang; tắt server sẽ dừng Sync, phần đã xong
            vẫn được giữ.
          </p>
        </div>
      ) : job && job.status !== 'running' ? (
        <p className="text-xs text-slate-500">
          Lần Sync gần nhất: {job.status === 'stopped' ? 'đã dừng' : job.status === 'error' ? 'lỗi' : 'xong'} · gắn nhãn{' '}
          {number(job.done - job.failed)} mục{job.removed ? `, xoá ${number(job.removed)} nhãn cũ` : ''}
          {job.failed ? `, ${number(job.failed)} mục lỗi` : ''}.{job.error ? ` ${job.error}` : ''}
        </p>
      ) : status.updatedAt ? (
        <p className="text-xs text-slate-500">Cập nhật lần cuối: {new Date(status.updatedAt).toLocaleString('vi-VN')}</p>
      ) : null}
      {!status.ready ? <p className="text-xs text-rose-600">Cần cài Claude Code (lệnh claude) và đăng nhập một lần.</p> : null}
      {actionError ? <p className="text-sm text-rose-600">{actionError}</p> : null}
    </Card>
  )
}
