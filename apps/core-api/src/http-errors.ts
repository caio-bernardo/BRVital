import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';

@Catch()
export class SafeErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<{ status: (status: number) => { json: (body: unknown) => void } }>();
    let status = 500, message: string | object = 'Não foi possível concluir a operação. Tente novamente.';
    if (error instanceof HttpException) {
      status = error.getStatus(); message = error.getResponse();
    } else if (typeof error === 'object' && error !== null && 'code' in error) {
      if (error.code === '23505') { status = 409; message = 'Já existe um cadastro ou solicitação com estes identificadores.'; }
      else if (['ECONNREFUSED', 'ETIMEDOUT', '53300', '57P01', '57014', '55P03', '40P01'].includes(String(error.code))) { status = 503; message = 'Serviço temporariamente indisponível. Aguarde e tente novamente.'; }
    }
    // Nunca escreve corpo da requisição, erros SQL, tokens ou respostas remotas em logs.
    if (status >= 500) console.error(JSON.stringify({ event: 'api.operation_failed', statusCode: status }));
    response.status(status).json(typeof message === 'string' ? { statusCode: status, message } : message);
  }
}
