import { IsInt, IsString, Min } from 'class-validator';

export class AddInterventionDto {
  @IsInt()
  @Min(0)
  odometerKm!: number;

  @IsString()
  workType!: string;

  @IsString()
  notesHash!: string;

  @IsString()
  evidenceUri!: string;

  @IsString()
  workshopAddress!: string;

  @IsString()
  workshopSignature!: string;

  @IsInt()
  @Min(1)
  recordedAtMs!: number;
}
