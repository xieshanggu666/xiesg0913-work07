import { useEffect, useState } from 'react'
import type { TrajFrame } from '@shared/types'
import { useStudio, type ExperimentMeta } from '../state/store'
import { ExperimentDialog } from './ExperimentDialog'
import {
  MAX_EXPERIMENT_CONCLUSION,
  PARAM_META,
  armStatus,
  computeMetricDeltas,
  formatDelta,
  summarizeBaselineValues
} from '../engine/experiment'

/** 删除二次确认等待时长（与快照删除一致：5 秒内可取消） */
const CONFIRM_MS = 5000

export function ExperimentBar(): JSX.Element {
  const experiments = useStudio((s) => s.experiments)
  const refreshExperiments = useStudio((s) => s.refreshExperiments)
  const showToast = useStudio((s) => s.showToast)
  const removeExperiment = useStudio((s) => s.removeExperiment)
  const saveExperimentConclusion = useStudio((s) => s.saveExperimentConclusion)

  // 发起实验的弹窗开 / 关；打开瞬间快照当前轨迹，实验全程只读该副本
  const [composing, setComposing] = useState(false)
  const [baseFrames, setBaseFrames] = useState<TrajFrame[] | null>(null)
  // 查看已保存实验
  const [viewing, setViewing] = useState<ExperimentMeta | null>(null)

  useEffect(() => {
    void refreshExperiments()
  }, [refreshExperiments])

  const startNew = (): void => {
    const frames = useStudio.getState().engine.traj
    if (frames.length < 2) {
      showToast('当前还没有可作为基准的成形轨迹，请先制作或导入一条')
      return
    }
    // 深拷贝：实验方案复制轨迹后离线运行，绝不改写当前作品 / 轨迹
    setBaseFrames(frames.map((f) => ({ dt: f.dt, input: structuredClone(f.input) })))
    setComposing(true)
  }

  return (
    <div className="panel experiments">
      <h3>工艺实验</h3>
      <div className="snap-form">
        <button className="primary" onClick={startNew}>
          ⚗ 以当前轨迹发起实验
        </button>
      </div>
      {experiments.length === 0 ? (
        <p className="muted small">
          选一条已有轨迹作为基准复制为实验方案：仅修改指定帧区间内的一项旋钮，分别运行后对照器形、
          关键指标差值与是否报废，并保存条件、结果和你的结论。
        </p>
      ) : (
        <ul className="exp-list">
          {experiments.map((meta) => (
            <ExperimentItem
              key={meta.record.id}
              meta={meta}
              onOpen={() => setViewing(meta)}
              onDelete={() => {
                if (meta.record.id != null) void removeExperiment(meta.record.id)
              }}
            />
          ))}
        </ul>
      )}

      {composing && baseFrames && (
        <ExperimentDialog frames={baseFrames} onClose={() => setComposing(false)} />
      )}
      {viewing && (
        <ExperimentViewer
          meta={viewing}
          onClose={() => setViewing(null)}
          onDelete={async () => {
            if (viewing.record.id == null) return
            await removeExperiment(viewing.record.id)
            setViewing(null)
          }}
          onSaveConclusion={(text) =>
            viewing.record.id != null
              ? saveExperimentConclusion(viewing.record.id, text)
              : Promise.resolve()
          }
        />
      )}
    </div>
  )
}

function ExperimentItem(props: {
  meta: ExperimentMeta
  onOpen: () => void
  onDelete: () => void
}): JSX.Element {
  const { meta, onOpen, onDelete } = props
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [confirming])

  const { condition: cond, outcome } = meta
  const pmeta = PARAM_META[cond.param]
  const status = armStatus(outcome.variant.metrics)

  return (
    <li>
      <div className="exp-thumbs">
        <img src={meta.record.baseline_thumb} alt="基准器形" />
        <img src={meta.record.variant_thumb} alt="实验器形" />
      </div>
      <div className="snap-info">
        <b>{meta.record.name}</b>
        <span className="snap-statusline">
          <i className={`snap-badge ${status.tone}`}>{status.status}</i>
          {cond.fromFrame}-{cond.toFrame}帧 · {pmeta.label}→{cond.value}
          {pmeta.unit}
        </span>
        {meta.record.conclusion && <span className="snap-note">{meta.record.conclusion}</span>}
        <span>{new Date(meta.record.created_at).toLocaleString()}</span>
        <div className="snap-actions">
          <button onClick={onOpen}>查看对照</button>
          {confirming ? (
            <>
              <button className="danger-btn confirm" onClick={onDelete}>
                确认删除
              </button>
              <button onClick={() => setConfirming(false)}>取消</button>
            </>
          ) : (
            <button className="danger-btn" onClick={() => setConfirming(true)}>
              删除
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

/** 只读查看一条已保存实验：条件、双臂器形、指标差值、报废状态；结论可补记 / 修改 */
function ExperimentViewer(props: {
  meta: ExperimentMeta
  onClose: () => void
  onDelete: () => Promise<void>
  onSaveConclusion: (text: string) => Promise<void>
}): JSX.Element {
  const { meta, onClose, onDelete, onSaveConclusion } = props
  const { condition: cond, outcome } = meta
  const pmeta = PARAM_META[cond.param]
  const deltas = computeMetricDeltas(outcome.baseline.metrics, outcome.variant.metrics)
  const baseStatus = armStatus(outcome.baseline.metrics)
  const varStatus = armStatus(outcome.variant.metrics)
  const baseSummary = summarizeBaselineValues(cond.baselineValues)

  const [conclusion, setConclusion] = useState(meta.record.conclusion)
  const [saving, setSaving] = useState(false)
  const dirty = conclusion !== meta.record.conclusion

  const saveConclusion = async (): Promise<void> => {
    setSaving(true)
    try {
      await onSaveConclusion(conclusion)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="exp-overlay" onClick={onClose}>
      <div className="exp-dialog" onClick={(ev) => ev.stopPropagation()}>
        <header className="exp-head">
          <h3>{meta.record.name}</h3>
          <button className="exp-close" onClick={onClose} title="关闭">
            ✕
          </button>
        </header>
        <div className="exp-result">
          <div className="exp-arms">
            <figure className="exp-arm">
              <figcaption>基准方案</figcaption>
              <img src={meta.record.baseline_thumb} alt="基准方案末帧器形" />
              <i className={`snap-badge ${baseStatus.tone}`}>{baseStatus.status}</i>
            </figure>
            <span className="exp-vs">对照</span>
            <figure className="exp-arm">
              <figcaption>实验方案</figcaption>
              <img src={meta.record.variant_thumb} alt="实验方案末帧器形" />
              <i className={`snap-badge ${varStatus.tone}`}>{varStatus.status}</i>
            </figure>
          </div>

          <p className="muted small exp-condline">
            基于 {cond.baselineFrames} 帧基准轨迹，第 {cond.fromFrame}–{cond.toFrame} 帧（共{' '}
            {cond.toFrame - cond.fromFrame} 帧）将 <b>{pmeta.label}</b> 由基准{' '}
            {baseSummary.avg.toFixed(pmeta.step < 1 ? 2 : 0)}
            {pmeta.unit}（区间均值）改为 <b>{cond.value}{pmeta.unit}</b>，其他输入逐帧一致。
            实验于 {new Date(meta.record.created_at).toLocaleString()} 保存。
          </p>

          <table className="exp-table">
            <thead>
              <tr>
                <th>关键指标</th>
                <th>基准</th>
                <th>实验</th>
                <th>差值</th>
              </tr>
            </thead>
            <tbody>
              {deltas.map((d) => (
                <tr key={d.key}>
                  <td>{d.label}</td>
                  <td>{d.baseline.toFixed(d.precision)}</td>
                  <td>{d.variant.toFixed(d.precision)}</td>
                  <td className={`exp-delta ${d.tone}`}>{formatDelta(d)}</td>
                </tr>
              ))}
              <tr>
                <td>是否报废</td>
                <td>{outcome.baseline.metrics.isRuined ? '是' : '否'}</td>
                <td>{outcome.variant.metrics.isRuined ? '是' : '否'}</td>
                <td className={outcome.variant.metrics.isRuined ? 'exp-delta bad' : 'exp-delta good'}>
                  {outcome.variant.metrics.isRuined ? '报废' : '完好'}
                </td>
              </tr>
            </tbody>
          </table>

          <label className="exp-conclusion">
            <span>
              用户结论
              <small className="muted">（{conclusion.length}/{MAX_EXPERIMENT_CONCLUSION} 字）</small>
            </span>
            <textarea
              value={conclusion}
              maxLength={MAX_EXPERIMENT_CONCLUSION}
              placeholder="补记实验结论…"
              onChange={(ev) => setConclusion(ev.target.value)}
            />
          </label>

          <div className="exp-foot">
            <button className="danger-btn" onClick={() => void onDelete()}>
              删除实验
            </button>
            <button className="primary" onClick={() => void saveConclusion()} disabled={saving || !dirty}>
              {saving ? '保存中…' : dirty ? '保存结论' : '结论已保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
