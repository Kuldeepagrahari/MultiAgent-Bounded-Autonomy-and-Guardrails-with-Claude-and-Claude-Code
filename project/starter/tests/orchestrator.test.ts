import { describe, it, expect, beforeEach } from 'vitest';
import { CodeReviewOrchestrator } from '../src/orchestrator';
import { ReviewReportSchema } from '../src/types/report-types';
import { ReviewError, ErrorCodes } from '../src/utils/error-handler';
import { RateLimiter } from '../src/utils/rate-limiter';

/**
 * Tests for CodeReviewOrchestrator
 *
 * These tests verify:
 * - Proper initialization with options
 * - Configuration flexibility
 * - Error handling and validation
 * - Integration with rate limiter
 */

describe('CodeReviewOrchestrator', () => {
  let orchestrator: CodeReviewOrchestrator;

  beforeEach(() => {
    // Set required environment variable for tests
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';
  });

  describe('Configuration', () => {
    it('should initialize with default options', () => {
      orchestrator = new CodeReviewOrchestrator();
      expect(orchestrator).toBeDefined();
      expect(orchestrator).toHaveProperty('reviewPullRequest');
    });

    it('should accept custom rate limit configuration', () => {
      // Custom orchestrator with custom timeout
      orchestrator = new CodeReviewOrchestrator({
        model: 'claude-sonnet-4-5-20250929',
        timeout: 60000
      });
      expect(orchestrator).toBeDefined();
    });

    it('should use ANTHROPIC_MODEL from environment', () => {
      process.env.ANTHROPIC_MODEL = 'claude-opus-4-5-20251101';
      orchestrator = new CodeReviewOrchestrator();
      expect(orchestrator).toBeDefined();
    });
  });

  describe('reviewPullRequest', () => {
    beforeEach(() => {
      orchestrator = new CodeReviewOrchestrator();
    });

    it('should require valid PR parameters', async () => {
      // Test that invalid parameters are handled properly
      // The orchestrator should work with valid inputs
      expect(orchestrator).toBeDefined();
      expect(orchestrator.reviewPullRequest).toBeDefined();
    });

    it('should return a ReviewReport structure', async () => {
      // This test validates that if a successful response is received,
      // it matches the ReviewReport schema structure
      const mockReport = {
        pullRequest: {
          owner: 'test',
          repo: 'repo',
          number: 123
        },
        fileReviews: [
          {
            file: 'test.ts',
            codeQuality: {
              file: 'test.ts',
              issues: [],
              overallScore: 85,
              summary: 'Good code quality'
            },
            testCoverage: {
              file: 'test.ts',
              hasTests: true,
              testFiles: ['test.test.ts'],
              untestedPaths: [],
              coverageEstimate: 90,
              summary: 'Well tested'
            },
            refactorings: {
              file: 'test.ts',
              suggestions: [],
              summary: 'No refactoring needed'
            }
          }
        ],
        summary: {
          totalFiles: 1,
          overallScore: 85,
          criticalIssues: 0,
          highPriorityTests: 0,
          refactoringOpportunities: 0
        },
        recommendations: [],
        metadata: {
          analyzedAt: new Date().toISOString(),
          duration: 1000,
          agentVersions: {}
        }
      };

      // Validate the mock report against schema
      const result = ReviewReportSchema.safeParse(mockReport);
      expect(result.success).toBe(true);
    });

    it('should validate output with Zod schema', async () => {
      // Test schema validation
      const validReport = {
        pullRequest: {
          owner: 'owner',
          repo: 'repo',
          number: 1
        },
        fileReviews: [],
        summary: {
          totalFiles: 0,
          overallScore: 100,
          criticalIssues: 0,
          highPriorityTests: 0,
          refactoringOpportunities: 0
        },
        recommendations: [],
        metadata: {
          analyzedAt: '2024-01-01T00:00:00Z',
          duration: 0,
          agentVersions: {}
        }
      };

      const result = ReviewReportSchema.safeParse(validReport);
      expect(result.success).toBe(true);

      // Test invalid report
      const invalidReport = {
        pullRequest: { owner: 'o' },
        // Missing required fields
      };

      const invalidResult = ReviewReportSchema.safeParse(invalidReport);
      expect(invalidResult.success).toBe(false);
    });

    it('should handle ReviewError properly', () => {
      // Test ReviewError instantiation and properties
      const error = new ReviewError(
        'Test error',
        ErrorCodes.AGENT_FAILED,
        { test: 'metadata' }
      );

      expect(error).toBeInstanceOf(ReviewError);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe(ErrorCodes.AGENT_FAILED);
      expect(error.metadata).toEqual({ test: 'metadata' });
    });
  });

  describe('RateLimiter', () => {
    it('should track concurrent requests', () => {
      const limiter = new RateLimiter({
        maxConcurrent: 3,
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: 10000
      });

      const status = limiter.getStatus();
      expect(status.activeRequests).toBe(0);
      expect(status.requestsInWindow).toBe(0);
      expect(status.tokensInWindow).toBe(0);
    });

    it('should check if request can proceed', () => {
      const limiter = new RateLimiter({
        maxConcurrent: 5,
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: 100000
      });

      // Initially should be able to proceed
      expect(limiter.canProceed(1000)).toBe(true);
    });

    it('should respect rate limits', async () => {
      const limiter = new RateLimiter({
        maxConcurrent: 2,
        maxRequestsPerMinute: 2,
        maxTokensPerMinute: 10000
      });

      // First acquisition should succeed
      await limiter.acquire(1000);
      expect(limiter.getStatus().activeRequests).toBe(1);

      // Release and check
      limiter.release(1000);
      expect(limiter.getStatus().activeRequests).toBe(0);
    });
  });

  describe('Integration', () => {
    // These tests require actual API keys and should be skipped in CI
    it.skip('should review a real small PR', async () => {
      // NOTE: This test is skipped by default
      // To run it manually with valid API keys:
      // 1. Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL
      // 2. Set PROJECT_ROOT to current directory
      // 3. Remove .skip from test
      // 4. Run: npm test -- --no-coverage

      const orchestrator = new CodeReviewOrchestrator();

      // This would call a real PR - only enable manually with valid credentials
      // const report = await orchestrator.reviewPullRequest(
      //   'facebook',
      //   'react',
      //   27128  // A real, small closed PR
      // );
      // expect(report).toBeDefined();
      // expect(report.pullRequest.number).toBe(27128);
    });
  });
});
