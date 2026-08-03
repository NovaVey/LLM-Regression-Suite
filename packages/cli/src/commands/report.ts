import {
  loadComparisonReportData,
  renderMarkdownReport,
  renderJsonReport,
  renderHtmlReport,
  type ComparisonReportData,
} from '@llmreg/core';

export type ReportFormat = 'markdown' | 'json' | 'html';

export interface ReportCommandOptions {
  comparisonId: string;
  format: ReportFormat;
}

export interface ReportCommandOutcome {
  data: ComparisonReportData;
  rendered: string;
}

export async function runReportCommand(options: ReportCommandOptions): Promise<ReportCommandOutcome> {
  const data = await loadComparisonReportData(options.comparisonId);

  let rendered: string;
  switch (options.format) {
    case 'markdown':
      rendered = renderMarkdownReport(data);
      break;
    case 'json':
      rendered = renderJsonReport(data);
      break;
    case 'html':
      rendered = renderHtmlReport(data);
      break;
    default: {
      const exhaustive: never = options.format;
      throw new Error(`Unknown report format: ${String(exhaustive)}`);
    }
  }

  return { data, rendered };
}
