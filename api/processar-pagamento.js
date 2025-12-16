// Função no SEU FRONTEND (hospedado em outro lugar, NÃO no Vercel)

async function iniciarProcessoDePagamento() {
    // ⚠️ ATENÇÃO: Os dados do cliente são coletados dos campos do formulário (inputs)
    const dadosCliente = {
        nomeCliente: document.getElementById('nome').value,
        cpfCnpj: document.getElementById('cpf').value.replace(/[^\d]/g, ''), // Remove caracteres não numéricos
        emailCliente: document.getElementById('email').value,
        valorCreditos: parseFloat(document.getElementById('valor').value) // Garante que é um número
        // Adicione outros dados se necessário, como 'descricao'
    };

    if (!dadosCliente.nomeCliente || !dadosCliente.cpfCnpj || !dadosCliente.emailCliente || !dadosCliente.valorCreditos) {
        alert('Por favor, preencha todos os campos corretamente.');
        return;
    }
    
    // URL da sua Vercel Function (substitua pelo seu domínio real!)
    const ASAAS_API_URL = 'https://SEU-DOMINIO.vercel.app/api/processar-pagamento';

    try {
        // Exibe um estado de carregamento para o usuário
        document.getElementById('status').innerText = 'Processando pagamento...';

        // 🚀 Chama o Backend (Vercel Function)
        const response = await fetch(ASAAS_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
                // NENHUM 'access_token' DO ASAAS AQUI!
            },
            body: JSON.stringify(dadosCliente)
        });

        const data = await response.json();

        if (response.ok) {
            // Sucesso! O backend retornou o QR Code e o Payload
            document.getElementById('status').innerText = 'PIX gerado com sucesso!';
            
            // 🖼️ Exibir o QR Code e o PIX Copia e Cola
            const qrCodeImage = document.getElementById('qrcode-img');
            const payloadText = document.getElementById('pix-payload');
            
            // O Vercel Function retorna o QR Code em base64 (string)
            qrCodeImage.src = `data:image/png;base64,${data.qrCode}`;
            payloadText.value = data.payload;
            
            console.log("PIX gerado:", data);

        } else {
            // Erro retornado pelo backend
            document.getElementById('status').innerText = `Erro: ${data.error || 'Falha desconhecida'}`;
            console.error("Erro no processamento:", data);
        }

    } catch (error) {
        // Erro de rede (ex: servidor indisponível)
        document.getElementById('status').innerText = 'Erro de conexão com o servidor de pagamentos.';
        console.error("Erro de conexão/fetch:", error);
    }
}