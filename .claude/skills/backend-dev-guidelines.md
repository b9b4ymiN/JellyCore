---
name: backend-dev-guidelines
description: Backend development best practices for Node.js, microservices, APIs, databases, and system architecture
---

# Backend Development Guidelines

Comprehensive backend development practices for scalable, maintainable, and secure server-side applications.

## When to Activate

- Designing new backend services or APIs
- Building microservices architecture
- Implementing authentication and authorization
- Optimizing database queries and performance
- Setting up logging, monitoring, and error handling
- Refactoring legacy backend code
- Code review for backend systems

## Architecture Patterns

### Layered Architecture

```
┌─────────────────────────┐
│   Routes / Controllers   │  ← HTTP handlers
├─────────────────────────┤
│   Services / Use Cases   │  ← Business logic
├─────────────────────────┤
│   Repositories / DAOs    │  ← Data access
├─────────────────────────┤
│      Models / Entities   │  ← Data structures
└─────────────────────────┘
```

**TypeScript Example:**

```typescript
// models/user.ts
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

// repositories/userRepository.ts
export class UserRepository {
  constructor(private db: Database) {}

  async findById(id: string): Promise<User | null> {
    return this.db.query('SELECT * FROM users WHERE id = ?', [id]);
  }

  async create(data: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    const id = generateId();
    const createdAt = new Date();
    await this.db.query(
      'INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)',
      [id, data.email, data.name, createdAt]
    );
    return { id, ...data, createdAt };
  }
}

// services/userService.ts
export class UserService {
  constructor(private userRepo: UserRepository) {}

  async registerUser(email: string, name: string): Promise<User> {
    // Business logic
    if (!this.isValidEmail(email)) {
      throw new ValidationError('Invalid email format');
    }

    const existing = await this.userRepo.findByEmail(email);
    if (existing) {
      throw new ConflictError('Email already registered');
    }

    return this.userRepo.create({ email, name });
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}

// routes/userRoutes.ts
export class UserController {
  constructor(private userService: UserService) {}

  register = async (req: Request, res: Response) => {
    try {
      const { email, name } = req.body;
      const user = await this.userService.registerUser(email, name);
      res.status(201).json(user);
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({ error: error.message });
      } else if (error instanceof ConflictError) {
        res.status(409).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };
}
```

## RESTful API Design

### URL Structure

```
✅ GOOD
GET    /api/v1/users              # List users
GET    /api/v1/users/:id          # Get user
POST   /api/v1/users              # Create user
PUT    /api/v1/users/:id          # Update user (full)
PATCH  /api/v1/users/:id          # Update user (partial)
DELETE /api/v1/users/:id          # Delete user

GET    /api/v1/users/:id/posts    # User's posts (nested resource)

❌ BAD
GET    /api/v1/getAllUsers
POST   /api/v1/createUser
GET    /api/v1/user-posts?userId=123
```

### HTTP Status Codes

```typescript
// Success
200 OK              // Request succeeded (GET, PUT, PATCH)
201 Created         // Resource created (POST)
204 No Content      // Success but no body (DELETE)

// Client Errors
400 Bad Request     // Invalid input
401 Unauthorized    // Not authenticated
403 Forbidden       // No permission
404 Not Found       // Resource doesn't exist
409 Conflict        // Duplicate resource
422 Unprocessable   // Validation failed
429 Too Many        // Rate limit exceeded

// Server Errors
500 Internal Error  // Server crashed
502 Bad Gateway     // Upstream service failed
503 Unavailable     // Service down (maintenance)
```

### Response Format

```typescript
// Success response
{
  "data": {
    "id": "123",
    "name": "John Doe"
  },
  "meta": {
    "timestamp": "2026-02-14T10:00:00Z"
  }
}

// List response with pagination
{
  "data": [
    { "id": "1", "name": "User 1" },
    { "id": "2", "name": "User 2" }
  ],
  "meta": {
    "page": 1,
    "perPage": 20,
    "total": 156,
    "totalPages": 8
  }
}

// Error response
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid email format",
    "details": [
      {
        "field": "email",
        "message": "Must be a valid email address"
      }
    ]
  }
}
```

## Database Best Practices

### Query Optimization

```typescript
// ✅ GOOD: Use indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);

// ✅ GOOD: Use prepared statements (prevent SQL injection)
const user = await db.query(
  'SELECT * FROM users WHERE email = ?',
  [email]
);

// ✅ GOOD: Limit results
const posts = await db.query(
  'SELECT * FROM posts ORDER BY created_at DESC LIMIT 20'
);

// ✅ GOOD: Use SELECT with specific columns
const users = await db.query(
  'SELECT id, name, email FROM users WHERE active = true'
);

// ❌ BAD: Select all columns
const users = await db.query('SELECT * FROM users');

// ❌ BAD: N+1 query problem
const users = await db.query('SELECT * FROM users');
for (const user of users) {
  user.posts = await db.query('SELECT * FROM posts WHERE user_id = ?', [user.id]);
}

// ✅ GOOD: Use JOIN to avoid N+1
const usersWithPosts = await db.query(`
  SELECT 
    u.id, u.name, u.email,
    p.id as post_id, p.title, p.content
  FROM users u
  LEFT JOIN posts p ON p.user_id = u.id
  WHERE u.active = true
`);
```

### Transactions

```typescript
async function transferMoney(fromId: string, toId: string, amount: number) {
  const transaction = await db.beginTransaction();
  
  try {
    // Deduct from sender
    await transaction.query(
      'UPDATE accounts SET balance = balance - ? WHERE id = ?',
      [amount, fromId]
    );
    
    // Add to receiver
    await transaction.query(
      'UPDATE accounts SET balance = balance + ? WHERE id = ?',
      [amount, toId]
    );
    
    // Record transaction
    await transaction.query(
      'INSERT INTO transactions (from_id, to_id, amount) VALUES (?, ?, ?)',
      [fromId, toId, amount]
    );
    
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
```

## Error Handling

### Custom Error Classes

```typescript
// errors/AppError.ts
export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number,
    public code: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}
```

### Global Error Handler

```typescript
// middleware/errorHandler.ts
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error('Error:', error);

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
      },
    });
  }

  // Unexpected errors
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}

// app.ts
app.use(errorHandler);
```

## Authentication & Authorization

### JWT Authentication

```typescript
import jwt from 'jsonwebtoken';

// Generate token
export function generateToken(userId: string): string {
  return jwt.sign(
    { userId, type: 'access' },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' }
  );
}

// Verify token middleware
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      throw new UnauthorizedError('No token provided');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
    req.userId = decoded.userId;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
    } else {
      next(error);
    }
  }
}

// Authorization middleware
export function authorize(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await getUserById(req.userId);
    
    if (!roles.includes(user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
}

// Usage
app.get('/admin/users', authenticate, authorize('admin'), adminController.listUsers);
```

## Logging

```typescript
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

// Usage
logger.info('User registered', { userId: user.id, email: user.email });
logger.error('Database error', { error, query });
logger.warn('Rate limit approaching', { userId, requestCount });
```

## Input Validation

```typescript
import { z } from 'zod';

// Define schema
const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  age: z.number().int().min(18).optional(),
});

// Validation middleware
export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            details: error.errors,
          },
        });
      } else {
        next(error);
      }
    }
  };
}

// Usage
app.post('/users', validate(createUserSchema), userController.create);
```

## Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later',
});

app.use('/api/', limiter);

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
});

app.post('/api/auth/login', authLimiter, authController.login);
```

## Testing

### Unit Tests

```typescript
// services/userService.test.ts
describe('UserService', () => {
  let userService: UserService;
  let mockRepo: jest.Mocked<UserRepository>;

  beforeEach(() => {
    mockRepo = {
      findByEmail: jest.fn(),
      create: jest.fn(),
    } as any;
    userService = new UserService(mockRepo);
  });

  it('should register a new user', async () => {
    mockRepo.findByEmail.mockResolvedValue(null);
    mockRepo.create.mockResolvedValue({
      id: '123',
      email: 'test@example.com',
      name: 'Test User',
      createdAt: new Date(),
    });

    const user = await userService.registerUser('test@example.com', 'Test User');

    expect(user.email).toBe('test@example.com');
    expect(mockRepo.create).toHaveBeenCalledWith({
      email: 'test@example.com',
      name: 'Test User',
    });
  });

  it('should throw error if email exists', async () => {
    mockRepo.findByEmail.mockResolvedValue({ id: '1' } as User);

    await expect(
      userService.registerUser('existing@example.com', 'Test')
    ).rejects.toThrow(ConflictError);
  });
});
```

## Environment Configuration

```typescript
// config.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.string().transform(Number),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const config = envSchema.parse(process.env);
```

## Dependency Injection

```typescript
// container.ts
export class Container {
  private db: Database;
  private userRepository: UserRepository;
  private userService: UserService;

  constructor() {
    this.db = new Database(config.DATABASE_URL);
    this.userRepository = new UserRepository(this.db);
    this.userService = new UserService(this.userRepository);
  }

  getUserService() {
    return this.userService;
  }
}

export const container = new Container();
```

## Performance Tips

1. **Use Connection Pooling** - Reuse database connections
2. **Cache Frequently Accessed Data** - Redis, in-memory cache
3. **Implement Pagination** - Never return all records
4. **Use Async/Await** - Non-blocking I/O operations
5. **Enable Compression** - Gzip responses
6. **Database Indexes** - Speed up queries
7. **Load Balancing** - Distribute traffic
8. **CDN for Static Assets** - Offload file serving

## Security Checklist

- ✅ Use HTTPS only
- ✅ Validate all inputs
- ✅ Use prepared statements (SQL injection prevention)
- ✅ Implement rate limiting
- ✅ Hash passwords (bcrypt, argon2)
- ✅ Use JWT with short expiration
- ✅ Enable CORS properly
- ✅ Set security headers (helmet.js)
- ✅ Keep dependencies updated
- ✅ Never commit secrets to git
- ✅ Implement audit logging
- ✅ Use principle of least privilege

---

**Remember:** Good backend code is maintainable, testable, and secure. Always think about scalability and future requirements.
