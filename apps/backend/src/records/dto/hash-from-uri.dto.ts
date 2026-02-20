import { IsString, IsUrl } from 'class-validator';

export class HashFromUriDto {
  @IsString()
  @IsUrl({ require_protocol: true })
  uri!: string;
}
