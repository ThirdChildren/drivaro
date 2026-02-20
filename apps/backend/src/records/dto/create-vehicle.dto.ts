import { IsInt, IsString, Matches, Max, Min } from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  vin!: string;

  @IsString()
  make!: string;

  @IsString()
  model!: string;

  @IsInt()
  @Min(1950)
  @Max(2100)
  year!: number;

  @Matches(/^0x[a-fA-F0-9]{2,}$/)
  ownerAddress!: string;
}
