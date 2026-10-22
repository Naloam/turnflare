import { t, useLocale } from '../lib/locale'
import type { ProjectStats } from '../types/api'
import { useApi } from '../hooks/useApi'
import { useHashRoute } from '../router/useHashRoute'
import { ApiView } from '../components/ApiView'
import { EmptyState } from '../components/EmptyState'
import { ProjectCostChart } from '../components/ProjectCostChart'
import { SectionCard } from '../components/SectionCard'
import { StatBar } from '../components/StatBar'
import { formatCost, formatTokens } from '../lib/format'
import { totalTokens } from '../lib/chartData'

const EMPTY_STATE = (
  <EmptyState
    title="还没有项目数据"
    description="先运行一次 turnflare scan，项目维度才会出现统计数据。"
  />
)

/** 项目对比：横向柱状图 + 明细表，点击项目跳到会话列表并带上筛选。 */
export function ProjectsPage() {
  useLocale()

  const state = useApi<readonly ProjectStats[]>('/stats/projects')
  const { navigate } = useHashRoute()

  return (
    <ApiView state={state} empty={EMPTY_STATE}>
      {(projects) => {
        if (projects.length === 0) {
          // 服务端返回空数组（而不是 null）时也要走引导空态，否则会渲染一张空表格
          return <>{EMPTY_STATE}</>
        }

        // 总成本为 0 时所有占比都记 0，避免出现 0/0 的 NaN
        const totalCost = projects.reduce(
          (sum, project) => sum + Math.max(0, project.cost.totalCost),
          0,
        )

        return (
          <div className="space-y-4 md:space-y-6">
            <SectionCard title="项目成本对比" description="比较各项目主对话的 API 等价成本">
              <ProjectCostChart projects={projects} />
            </SectionCard>

            <SectionCard title="项目明细">
              <div className="overflow-x-auto">
                <table
                  className="w-full min-w-[40rem] border-collapse text-sm"
                  data-testid="projects-table"
                >
                  <thead>
                    <tr className="border-b border-border-subtle text-left text-xs text-ink-3">
                      <th scope="col" className="px-2 py-3 font-medium">
                        {t('项目')}
                      </th>
                      <th scope="col" className="px-2 py-3 text-right font-medium">
                        {t('会话数')}
                      </th>
                      <th scope="col" className="px-2 py-3 text-right font-medium">
                        Token
                      </th>
                      <th scope="col" className="px-2 py-3 text-right font-medium">
                        {t('成本')}
                      </th>
                      <th scope="col" className="px-2 py-3 font-medium">
                        {t('占比')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((project) => {
                      const cost = Math.max(0, project.cost.totalCost)
                      const share = totalCost > 0 ? cost / totalCost : 0
                      return (
                        <tr
                          key={project.projectSlug}
                          className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-2"
                          onClick={() => {
                            navigate(`/sessions?project=${encodeURIComponent(project.projectSlug)}`)
                          }}
                          data-testid="project-row"
                        >
                          <td className="px-2 py-3 font-medium text-ink-1">
                            {project.projectSlug}
                          </td>
                          <td className="px-2 py-3 text-right tabular-nums text-ink-2">
                            {project.sessionCount}
                          </td>
                          <td className="px-2 py-3 text-right tabular-nums text-ink-2">
                            {formatTokens(totalTokens(project.usage))}
                          </td>
                          <td className="px-2 py-3 text-right tabular-nums text-ink-1">
                            {formatCost(cost)}
                          </td>
                          <td className="px-2 py-3">
                            <StatBar ratio={share} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )
      }}
    </ApiView>
  )
}
