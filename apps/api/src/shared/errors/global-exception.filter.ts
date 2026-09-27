import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { getContext } from '../context/request-context';

/**
 * Global error boundary — BUILD_SPEC §6.
 *
 * "Errors returned to clients never leak internal identifiers, stack traces,
 * or the existence of records the caller cannot see."
 *
 * Two rules, both easy to violate by accident:
 *
 * 1. UNEXPECTED errors become an opaque 500. Whatever the cause — a Postgres
 *    error naming a table and column, a driver message quoting the failed SQL,
 *    a null dereference — the client gets a request id and nothing else. The
 *    detail goes to the server log, where it belongs.
 *
 * 2. VALIDATION errors become a 400 that describes the SHAPE of the problem
 *    without echoing values. Echoing the input back is how a phone number ends
 *    up in a proxy log.
 *
 * Deliberately NOT translated here: NotFoundException. Services already return
 * 404 rather than 403 for records the caller may not see, and that distinction
 * has to survive this filter intact.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = getContext()?.requestId;

    // --- validation ---------------------------------------------------------
    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        // Field paths and rule names only — never the submitted values.
        details: exception.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
        })),
        ...(requestId !== undefined ? { requestId } : {}),
      });
      return;
    }

    if (isDomainValidationError(exception)) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: exception.message,
        ...(requestId !== undefined ? { requestId } : {}),
      });
      return;
    }

    // --- deliberate HTTP errors --------------------------------------------
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(
        typeof body === 'string'
          ? {
              statusCode: status,
              message: body,
              ...(requestId !== undefined ? { requestId } : {}),
            }
          : { ...(body as object), ...(requestId !== undefined ? { requestId } : {}) },
      );
      return;
    }

    // --- body-parser refusals ------------------------------------------------
    // The raw() parsers mounted in main.ts (chunk uploads, verification
    // documents) throw http-errors, not HttpExceptions. Their 4xx is the
    // client's fault and `expose` marks the message safe; a 500 here told a
    // user with an oversized file that the server broke.
    if (isExposedClientError(exception)) {
      response.status(exception.status).json({
        statusCode: exception.status,
        message: exception.message,
        ...(requestId !== undefined ? { requestId } : {}),
      });
      return;
    }

    // --- everything else ----------------------------------------------------
    // Log the real cause server-side; return nothing useful to the caller.
    this.logger.error(
      `unhandled error (requestId=${requestId ?? 'none'}): ${
        exception instanceof Error ? `${exception.name}: ${exception.message}` : String(exception)
      }`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      ...(requestId !== undefined ? { requestId } : {}),
    });
  }
}

/**
 * Domain errors that represent bad input rather than a server fault.
 *
 * Matched by name rather than by `instanceof` so a module can raise one
 * without importing from shared/ in a direction the boundary rules would
 * flag — and so this filter needs no knowledge of any module (§5.1 rule 4).
 */
const VALIDATION_ERROR_NAMES = new Set([
  'InvalidPhoneError',
  'ConsentTextMismatchError',
  'DicomValidationError',
  // A corrupt transfer is bad input, not a server fault. Returning 500 would
  // tell a doctor on a dropping link "the server broke" — inviting a blind
  // retry — when the correct signal is "those bytes were corrupt, send the
  // file again" (P7.2). The message names no identifiers; the expected and
  // actual digests stay on the error object, server-side.
  'ChecksumMismatchError',
]);

/** An http-errors 4xx its author marked safe to show (body-parser sets `expose`). */
function isExposedClientError(err: unknown): err is Error & { status: number } {
  if (!(err instanceof Error)) return false;
  const { status, expose } = err as Error & { status?: unknown; expose?: unknown };
  return expose === true && typeof status === 'number' && status >= 400 && status < 500;
}

function isDomainValidationError(err: unknown): err is Error {
  return err instanceof Error && VALIDATION_ERROR_NAMES.has(err.name);
}
