import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  status() {
    return {
      status: 'ok',
      service: 'iota-auto-passport-backend',
      time: new Date().toISOString(),
    };
  }
}
