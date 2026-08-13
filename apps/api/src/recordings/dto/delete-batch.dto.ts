import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

// Teto de 200 por chamada: acima disso a requisição segura a transação de
// exclusão (que usa trava de instalação) por tempo demais e a retenção
// automática fica esperando. Apagar 500 gravações é trabalho de política de
// retenção, não de clique.
export class DeleteBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  recordingIds!: string[];
}
