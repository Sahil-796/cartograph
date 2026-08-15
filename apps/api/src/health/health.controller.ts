import { Controller, Get, HttpCode } from '@nestjs/common';

interface HealthResponse {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(200)
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
