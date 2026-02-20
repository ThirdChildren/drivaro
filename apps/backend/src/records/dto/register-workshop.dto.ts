import { IsOptional, IsString, Matches } from 'class-validator';

export class RegisterWorkshopDto {
  @Matches(/^0x[a-fA-F0-9]{2,}$/)
  workshopAddress!: string;

  @IsOptional()
  @IsString()
  did?: string;

  @IsString()
  publicKeyMultibase!: string;
}
