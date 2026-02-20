import { IsOptional, IsString } from 'class-validator';

export class PublishContractDto {
  @IsOptional()
  @IsString()
  packagePath?: string;
}
