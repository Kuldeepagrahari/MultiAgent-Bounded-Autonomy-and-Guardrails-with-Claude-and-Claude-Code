import { query, Options } from '@anthropic-ai/claude-agent-sdk';
import { logger } from './utils/logger';
import { ReviewReport, ReviewReportSchema, ReviewReportJSONSchema } from './types/report-types';
import { buildOrchestratorPrompt } from './prompts';
import { getMcpServersConfig } from './config/mcp.config';
import { ReviewError, ErrorCodes } from './utils/error-handler';
import { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester } from './agents';

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  model?: string;
  timeout?: number;
}

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  private model: string;
  private timeout: number;

  constructor(options: OrchestratorOptions = {}) {
    this.model = options.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
    this.timeout = options.timeout || 300000; // 5 minutes default
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startTime = Date.now();

    try {
      logger.info('Starting PR review', { owner, repo, prNumber });

      const prompt = buildOrchestratorPrompt(owner, repo, prNumber);

      // Build MCP servers configuration as Record<string, MCP server config>
      const mcpServers = getMcpServersConfig();

      // Define subagents using exported definitions
      const agents = {
        'code-quality-analyzer': codeQualityAnalyzer,
        'test-coverage-analyzer': testCoverageAnalyzer,
        'refactoring-suggester': refactoringSuggester
      };

      // Create query options
      const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();
      const options: Options = {
        model: this.model,
        agents,
        mcpServers,
        cwd: PROJECT_ROOT,
        // Allow MCP tools, Skill tool for custom skills, and Task tool for subagent spawning
        allowedTools: [
          'Task',
          'Skill',
          // GitHub MCP tools
          'mcp__github__get_pull_request',
          'mcp__github__get_pull_request_files',
          'mcp__github__get_file_contents',
          'mcp__github__list_pull_requests',
          // ESLint MCP tools (allow wildcard pattern if supported)
          'mcp__eslint__lint_files'
        ],
        // Configure skill discovery
        settingSources: ['project'],
        // Set output format for structured output
        outputFormat: {
          type: 'json_schema',
          schema: ReviewReportJSONSchema
        }
      };

      // Execute the orchestrator prompt
      const q = query({ prompt, options });

      let structuredOutput: unknown = null;
      let lastMessage: any = null;

      // Iterate through query messages
      for await (const message of q) {
        lastMessage = message;

        // Check for result message with structured output
        if (message.type === 'result' && 'structured_output' in message && message.structured_output) {
          structuredOutput = message.structured_output;
          break;
        }
      }

      // Validate that we got structured output
      if (!structuredOutput) {
        throw new ReviewError(
          'SDK failed to produce structured_output for orchestrator. The model may not have completed the analysis or returned invalid output.',
          ErrorCodes.STRUCTURED_OUTPUT_FAILED,
          { owner, repo, prNumber, lastMessage }
        );
      }

      // Validate the output against the schema
      let report: ReviewReport;
      try {
        report = ReviewReportSchema.parse(structuredOutput);
      } catch (error) {
        throw new ReviewError(
          `Structured output validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ErrorCodes.VALIDATION_FAILED,
          { owner, repo, prNumber, output: structuredOutput }
        );
      }

      // Add metadata
      const duration = Date.now() - startTime;
      report.metadata.analyzedAt = new Date().toISOString();
      report.metadata.duration = duration;

      logger.info('PR review completed successfully', {
        owner,
        repo,
        prNumber,
        score: report.summary.overallScore,
        duration
      });

      return report;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof ReviewError) {
        logger.error('PR review failed with ReviewError', {
          owner,
          repo,
          prNumber,
          error: error.message,
          code: error.code,
          duration
        });
        throw error;
      }

      logger.error('PR review failed', {
        owner,
        repo,
        prNumber,
        error: error instanceof Error ? error.message : String(error),
        duration
      });

      throw new ReviewError(
        `Orchestrator failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.AGENT_FAILED,
        { owner, repo, prNumber }
      );
    }
  }
}
