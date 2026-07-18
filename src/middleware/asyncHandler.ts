import type { NextFunction, Request, Response } from 'express';

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

// Wraps async route handlers so a thrown/rejected error goes to Express's
// error middleware instead of crashing the process or hanging the request —
// the old backend repeated try/catch in every single handler by hand, which
// is exactly the kind of boilerplate that occasionally gets forgotten.
export const asyncHandler =
  (handler: Handler) => (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
