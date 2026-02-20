import { Module } from '@nestjs/common';

import { IotaModule } from '../iota/iota.module';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';

@Module({
  imports: [IotaModule],
  controllers: [RecordsController],
  providers: [RecordsService],
})
export class RecordsModule {}
