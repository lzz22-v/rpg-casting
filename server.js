const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

// --- CONFIGURAÇÃO DO MONGODB ---
// Substitua pela sua URI correta (com o host flnqilb ou f1nqilb conforme testamos)
const uri = "mongodb+srv://luizvale132_db_user:R04cTRkJ4GgOYdPb@cluster0.flnqilb.mongodb.net/project0?retryWrites=true&w=majority";

mongoose.connect(uri)
    .then(() => console.log('Conectado ao MongoDB Atlas com sucesso!'))
    .catch(err => console.error('Erro na conexão com MongoDB:', err));

// --- MODELOS DE DADOS (SCHEMAS) ---

// 1. Personagens
const characterSchema = new mongoose.Schema({
    name: { type: String, required: true },
    img: { type: String, required: true },
    owner: { type: Number, default: null }, // 1 ou 2 (POSSE)
    active: { type: Boolean, default: false } // NOVO: É o personagem ATIVO no chat?
});
const Character = mongoose.model('Character', characterSchema);

// 2. Mensagens do Chat
const messageSchema = new mongoose.Schema({
    playerId: Number,        // Quem enviou (1 ou 2)
    senderName: String,      // O nome do personagem (ou Jogador X) NO MOMENTO do envio
    text: String,            // O conteúdo
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);


// --- FUNÇÕES AUXILIARES ---

// NOVO: Função para garantir que apenas UM personagem esteja 'active: true'
async function deactivatePreviousCharacter(playerId, currentActiveCharId) {
    // Desativa todos os personagens ativos anteriores do jogador, exceto o que está sendo definido agora
    await Character.updateMany(
        { owner: playerId, active: true, _id: { $ne: currentActiveCharId } },
        { active: false }
    );
}

// Popular banco inicial
async function initializeCharacters() {
    const count = await Character.countDocuments();
    if (count === 0) {
        // Garantindo que novos personagens comecem com active: false
        await Character.insertMany([
            { name: "Pio XIII", img: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Pius_XII_1950s.jpg/220px-Pius_XII_1950s.jpg", owner: null, active: false },
            { name: "Voiello", img: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Portrait_of_Cardinal_Mazarin.jpg/220px-Portrait_of_Cardinal_Mazarin.jpg", owner: null, active: false }
        ]);
        console.log('Personagens iniciais criados.');
    }
}
mongoose.connection.once('open', initializeCharacters);

// Emitir lista de personagens
const emitUpdatedList = async (socketOrIo) => {
    const characters = await Character.find({});
    socketOrIo.emit('update_list', characters);
};

// Emitir histórico de chat
const emitChatHistory = async (socket) => {
    // Pega as últimas 50 mensagens
    const messages = await Message.find().sort({ timestamp: 1 }).limit(50);
    socket.emit('chat_history', messages);
};

app.use(express.static('public'));

// --- LÓGICA DO SOCKET.IO ---

io.on('connection', (socket) => {
    console.log('Jogador conectado:', socket.id);

    // Envia dados iniciais
    emitUpdatedList(socket);
    emitChatHistory(socket);

    // --- Lógica de Personagens ---
    
    // 1. Assumir Posse (Apenas se o personagem estiver livre)
    socket.on('claim_character', async (data) => {
        // Tenta encontrar e atualizar APENAS se o 'owner' for null
        const result = await Character.findOneAndUpdate(
            { _id: data.charId, owner: null },
            { owner: data.playerId, active: true }, // Ao assumir a posse, ele se torna ATIVO
            { new: true }
        );
        if (result) {
            // Desativa qualquer outro personagem que o jogador estivesse interpretando antes
            await deactivatePreviousCharacter(data.playerId, data.charId);
            emitUpdatedList(io);
        }
    });

    // 2. NOVO: Definir Personagem Ativo (Apenas se já for o dono)
    socket.on('set_active', async (data) => {
        // 1. Desativa todos os personagens ativos anteriores do jogador
        await deactivatePreviousCharacter(data.playerId, data.charId);

        // 2. Ativa o novo personagem (garantindo que ele realmente pertença ao jogador)
        const result = await Character.findOneAndUpdate(
            { _id: data.charId, owner: data.playerId },
            { active: true },
            { new: true }
        );

        if (result) emitUpdatedList(io);
    });
    
    // 3. Deixar Posse (Deleta o personagem da posse do jogador)
    socket.on('release_character', async (data) => {
        const result = await Character.findOneAndUpdate(
            { _id: data.charId, owner: data.playerId },
            { owner: null, active: false }, // Ao largar a posse, ele perde o status de ativo
            { new: true }
        );
        if (result) emitUpdatedList(io);
    });

    socket.on('create_character', async (newChar) => {
        await Character.create({ ...newChar, owner: null, active: false }); // Novo personagem é sempre inativo
        emitUpdatedList(io);
    });

    socket.on('delete_character', async (charId) => {
        await Character.findByIdAndDelete(charId);
        emitUpdatedList(io);
    });

    // --- Lógica do Chat (ATUALIZADO) ---
    socket.on('send_message', async (data) => {
        // data = { playerId: 1, text: "Olá" }
        
        // 1. Descobrir quem o jogador está interpretando AGORA (busca por owner E active: true)
        const activeChar = await Character.findOne({ owner: data.playerId, active: true });
        
        // Se tiver personagem ativo, usa o nome dele. Se não, usa "Jogador X"
        const displayName = activeChar ? activeChar.name : `Jogador ${data.playerId}`;

        // 2. Salvar no Banco
        const newMessage = await Message.create({
            playerId: data.playerId,
            senderName: displayName,
            text: data.text
        });

        // 3. Enviar para todos
        io.emit('receive_message', newMessage);
    });
});

http.listen(3000, () => {
    console.log('Servidor rodando na porta 3000');
});

// A função 'deactivatePreviousCharacter' garante a regra central do seu RP:
// Apenas o personagem mais recentemente ativado será o 'active: true',
// garantindo que somente ele seja usado para o chat.