import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from './store'

/** storage.ts 的浏览器降级依赖 localStorage，node 环境下用内存 stub */
const lsData = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => lsData.get(k) ?? null,
  setItem: (k: string, v: string) => {
    lsData.set(k, String(v))
  },
  removeItem: (k: string) => {
    lsData.delete(k)
  },
  clear: () => lsData.clear()
})

function storedCount(): number {
  return (JSON.parse(lsData.get('glass-forge:snapshots') ?? '[]') as unknown[]).length
}

describe('快照删除', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    lsData.clear()
    await useStudio.getState().refreshSnapshots()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('删除立即生效：列表与存储同时移除', async () => {
    const ok = await useStudio.getState().addSnapshot('节点A', '备注', 'thumb')
    expect(ok).toBe(true)
    expect(useStudio.getState().snapshots).toHaveLength(1)
    const id = useStudio.getState().snapshots[0].record.id!

    await useStudio.getState().removeSnapshot(id)

    expect(useStudio.getState().snapshots).toHaveLength(0)
    expect(storedCount()).toBe(0)
    expect(useStudio.getState().toast).toBe('已删除快照「节点A」')
  })

  it('删除失败时保留快照并给出一致提示', async () => {
    await useStudio.getState().addSnapshot('节点A', '', 'thumb')
    const id = useStudio.getState().snapshots[0].record.id!

    // 让底层存储写入失败
    const ls = localStorage as unknown as { setItem: (k: string, v: string) => void }
    const original = ls.setItem
    ls.setItem = () => {
      throw new Error('磁盘写入失败')
    }
    try {
      await useStudio.getState().removeSnapshot(id)
    } finally {
      ls.setItem = original
    }

    expect(useStudio.getState().toast).toBe('删除快照失败：磁盘写入失败')
    expect(useStudio.getState().snapshots).toHaveLength(1)
  })
})

describe('回放时间轴与帧标注', () => {
  /** 录一段轨迹并进入回放模式 */
  function recordAndPlay(frames = 90): void {
    useStudio.getState().stopReplay()
    useStudio.getState().resetGlass()
    const e = useStudio.getState().engine
    for (let i = 0; i < frames; i++) {
      e.setTool('flame')
      e.setPointer(0, 0.5)
      e.setPressure(0.8)
      e.tick()
    }
    useStudio.getState().playReplay()
  }

  it('拖动定位 / 单帧步进 / 速度选择同步到状态', () => {
    recordAndPlay()
    expect(useStudio.getState().replaying).toBe(true)
    expect(useStudio.getState().replayPlaying).toBe(true)
    expect(useStudio.getState().replayFrameCount).toBe(90)

    useStudio.getState().seekFrame(30)
    expect(useStudio.getState().replayFrame).toBe(30)
    // 拖动定位不改变播放 / 暂停状态
    expect(useStudio.getState().replayPlaying).toBe(true)

    useStudio.getState().stepFrame(1)
    expect(useStudio.getState().replayFrame).toBe(31)
    // 单帧步进自动暂停
    expect(useStudio.getState().replayPlaying).toBe(false)

    useStudio.getState().stepFrame(-2)
    expect(useStudio.getState().replayFrame).toBe(29)

    useStudio.getState().setReplaySpeed(2)
    expect(useStudio.getState().replaySpeed).toBe(2)
    expect(useStudio.getState().engine.replaySpeed).toBe(2)

    useStudio.getState().toggleReplayPlay()
    expect(useStudio.getState().replayPlaying).toBe(true)

    useStudio.getState().stopReplay()
    expect(useStudio.getState().replaying).toBe(false)
    expect(useStudio.getState().replayFrame).toBe(0)
  })

  it('当前帧标注的添加与删除', () => {
    recordAndPlay()
    useStudio.getState().seekFrame(12)
    expect(useStudio.getState().addAnnotation('  鼓腹完成  ')).toBe(true)
    expect(useStudio.getState().addAnnotation('开始收颈')).toBe(true)
    // 空内容 / 纯空白拒绝并提示
    expect(useStudio.getState().addAnnotation('   ')).toBe(false)
    expect(useStudio.getState().toast).toBe('标注内容不能为空')

    const anns = useStudio.getState().annotations
    expect(anns).toHaveLength(2)
    expect(anns[0].frame).toBe(12)
    expect(anns[0].text).toBe('鼓腹完成')

    useStudio.getState().removeAnnotation(anns[0].id)
    expect(useStudio.getState().annotations).toHaveLength(1)
    expect(useStudio.getState().annotations[0].text).toBe('开始收颈')
  })

  it('停止回放保留标注；取新料重来清空标注', () => {
    recordAndPlay()
    useStudio.getState().seekFrame(5)
    useStudio.getState().addAnnotation('标记')
    expect(useStudio.getState().annotations).toHaveLength(1)

    // 停止回放：轨迹还在，标注保留，再次回放仍可见
    useStudio.getState().stopReplay()
    expect(useStudio.getState().annotations).toHaveLength(1)

    // 取新料重来：轨迹清空，依附帧号的标注一并失效
    useStudio.getState().resetGlass()
    expect(useStudio.getState().annotations).toHaveLength(0)
    expect(useStudio.getState().replaying).toBe(false)
  })

  it('没有轨迹时不能导入标注', async () => {
    useStudio.getState().stopReplay()
    useStudio.getState().resetGlass()
    await useStudio.getState().importAnnotations()
    expect(useStudio.getState().toast).toBe('请先录制或导入一条轨迹，再导入与它配套的标注')
  })
})
