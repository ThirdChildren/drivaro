import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';

import { AddInterventionDto } from './dto/add-intervention.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { PublishContractDto } from './dto/publish-contract.dto';
import { RegisterWorkshopDto } from './dto/register-workshop.dto';
import { RecordsService } from './records.service';

@Controller()
export class RecordsController {
  constructor(@Inject(RecordsService) private readonly records: RecordsService) {}

  @Get('config')
  getConfig() {
    return this.records.getConfig();
  }

  @Post('contracts/publish')
  publishContract(@Body() dto: PublishContractDto) {
    return this.records.publishContract(dto.packagePath);
  }

  @Post('workshops')
  registerWorkshop(@Body() dto: RegisterWorkshopDto) {
    return this.records.registerWorkshop(dto);
  }

  @Get('workshops')
  listWorkshops() {
    return this.records.listWorkshops();
  }

  @Post('vehicles')
  createVehicle(@Body() dto: CreateVehicleDto) {
    return this.records.createVehicle(dto);
  }

  @Get('vehicles')
  listVehicles() {
    return this.records.listVehicles();
  }

  @Get('vehicles/:vin')
  getVehicleByVin(@Param('vin') vin: string) {
    return this.records.getVehicleByVin(vin);
  }

  @Post('vehicles/:passportId/interventions')
  addIntervention(@Param('passportId') passportId: string, @Body() dto: AddInterventionDto) {
    return this.records.addIntervention(passportId, dto);
  }
}
