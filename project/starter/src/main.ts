// Load environment variables FIRST, before any other imports
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { CodeReviewOrchestrator } from './orchestrator';
import { ReportGenerator } from './utils/report-generator';
import { logger, logReviewStart, logReviewComplete, logReviewError } from './utils/logger';
import { ReviewError, ErrorCodes } from './utils/error-handler';

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main() {
  const [owner, repo, prStr] = process.argv.slice(2);

  // Validate command line arguments
  if (!owner || !repo || !prStr) {
    console.error('❌ Missing required arguments');
    console.error('Usage: npm run dev <owner> <repo> <pr-number>');
    console.error('Example: npm run dev facebook react 12345');
    process.exit(1);
  }

  // Convert and validate PR number
  const prNumber = parseInt(prStr, 10);
  if (isNaN(prNumber) || prNumber <= 0) {
    console.error(`❌ Invalid PR number: "${prStr}". Must be a positive integer.`);
    process.exit(1);
  }

  // Validate authentication method
  const hasAnthropicAuth = !!process.env.ANTHROPIC_API_KEY;
  const hasBedrockAuth =
    !!process.env.AWS_ACCESS_KEY_ID &&
    !!process.env.AWS_SECRET_ACCESS_KEY;

  if (!hasAnthropicAuth && !hasBedrockAuth) {
    console.error('❌ Authentication not configured');
    console.error('Please set ONE of the following:');
    console.error('  Option 1 (Anthropic API):');
    console.error('    export ANTHROPIC_API_KEY=sk-ant-...');
    console.error('  Option 2 (AWS Bedrock):');
    console.error('    export AWS_ACCESS_KEY_ID=...');
    console.error('    export AWS_SECRET_ACCESS_KEY=...');
    console.error('    export AWS_REGION=us-east-1');
    process.exit(1);
  }

  // Log authentication method
  if (hasBedrockAuth) {
    if (!process.env.AWS_REGION) {
      console.error('❌ AWS_REGION is required when using AWS Bedrock');
      process.exit(1);
    }
    console.log('🔐 Using AWS Bedrock authentication');
  } else {
    console.log('🔐 Using Anthropic API authentication');
  }

  // Validate ANTHROPIC_MODEL environment variable
  if (!process.env.ANTHROPIC_MODEL) {
    console.error('❌ ANTHROPIC_MODEL environment variable is not set');
    console.error('Please set it to:');
    if (hasBedrockAuth) {
      console.error('  ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0');
    } else {
      console.error('  ANTHROPIC_MODEL=claude-sonnet-4-5-20250929');
    }
    process.exit(1);
  }

  try {
    logReviewStart(owner, repo, prNumber);
    console.log(`\n📊 Starting code review of ${owner}/${repo}#${prNumber}...\n`);

    // Create orchestrator instance
    const orchestrator = new CodeReviewOrchestrator({
      model: process.env.ANTHROPIC_MODEL
    });

    // Call reviewPullRequest
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    // Generate formatted reports using ReportGenerator
    const reportGenerator = new ReportGenerator();

    // Create reports directory if it doesn't exist
    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    // Generate and save reports
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const baseFilename = `review_${owner}_${repo}_${prNumber}_${timestamp}`;

    // Markdown report
    const markdownReport = reportGenerator.generateMarkdownReport(report);
    const markdownPath = path.join(reportsDir, `${baseFilename}.md`);
    fs.writeFileSync(markdownPath, markdownReport, 'utf-8');
    console.log(`✅ Markdown report saved: ${markdownPath}`);

    // HTML report
    const htmlReport = reportGenerator.generateHTMLReport(report);
    const htmlPath = path.join(reportsDir, `${baseFilename}.html`);
    fs.writeFileSync(htmlPath, htmlReport, 'utf-8');
    console.log(`✅ HTML report saved: ${htmlPath}`);

    // JSON report
    const jsonReport = reportGenerator.generateJSONReport(report);
    const jsonPath = path.join(reportsDir, `${baseFilename}.json`);
    fs.writeFileSync(jsonPath, jsonReport, 'utf-8');
    console.log(`✅ JSON report saved: ${jsonPath}`);

    logReviewComplete(owner, repo, prNumber, report.summary.overallScore, report.metadata.duration);
    console.log(`\n🎉 Review complete! Overall score: ${report.summary.overallScore}/100\n`);
  } catch (error) {
    if (error instanceof ReviewError) {
      console.error(`\n❌ ${error.code}: ${error.message}`);
      logger.error('Review failed with ReviewError', {
        code: error.code,
        message: error.message,
        metadata: error.metadata
      });
    } else {
      console.error(`\n❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
      logger.error('Review failed with unexpected error', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    logReviewError(owner, repo, prNumber, error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

main();
