# Operação de pedidos LGPD — procedimento preliminar

Aplicável somente à demonstração sintética. Aprovação do DPO, política de retenção, canal de entrega seguro e rotina operacional executável continuam bloqueios do piloto real.

## Recebimento

`POST /v1/privacy-requests` autentica o paciente, registra `export` ou `erase`, gera protocolo UUID v7, confirma imediatamente e define prazo de 15 dias corridos. O registro não significa que a exportação ou exclusão foi executada. As telas deixam essa diferença explícita.

A equipe deve acompanhar solicitações em `ops.privacy_request` usando credenciais operacionais autorizadas, nunca expondo acesso ao banco no app. Não consultar/exportar PII por logs, e-mail comum ou ferramentas de analytics.

## Exportação

1. Verificar identidade do titular pelo canal aprovado, sem solicitar documento em log ou ticket público.
2. Localizar o paciente pelo identificador associado à solicitação; não permitir troca do titular por parâmetro do cliente.
3. Exportar somente seus dados de cadastro, consentimentos, respostas, laudos, tickets, desfechos e pedidos. Decriptar PII somente no ambiente autorizado.
4. Entregar por canal autenticado com validade limitada; não colocar PII no histórico do shell ou na saída de CI.
5. Registrar evidência da conclusão pelo protocolo, sem copiar o conteúdo para auditoria.

## Exclusão/anonimização

1. Confirmar identidade e escopo; verificar obrigações legais e retenção aprovada pelo DPO.
2. Tratar senhas pendentes/ativas e dados já compartilhados com a unidade; coordenar a solicitação com o hospital responsável.
3. Anonimizar identificadores pessoais em `identity`, invalidar acesso e revogar consentimentos conforme política aprovada. Limpar desafios OTP e cópias operacionais sob retenção aplicável.
4. Preservar o mínimo legal e a rastreabilidade autorizada. Não desabilitar triggers ou apagar laudos e trilhas imutáveis para atender a um pedido sem decisão jurídica documentada.
5. Registrar conclusão e responder ao titular em até 15 dias.

A implementação atual apenas recebe e audita o pedido. Não existe comando automático de apagamento nesta entrega; não executar SQL destrutivo improvisado.
