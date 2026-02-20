import { Module } from '@nestjs/common';

import { IotaCliService } from './iota.service';

@Module({
  providers: [IotaCliService],
  exports: [IotaCliService],
})
export class IotaModule {}
