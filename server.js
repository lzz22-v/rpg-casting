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
    owner: { type: Number, default: null } // 1 ou 2
});
const Character = mongoose.model('Character', characterSchema);

// 2. Mensagens do Chat (NOVO)
const messageSchema = new mongoose.Schema({
    playerId: Number,        // Quem enviou (1 ou 2)
    senderName: String,      // O nome do personagem (ou Jogador X) NO MOMENTO do envio
    text: String,            // O conteúdo
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);


// --- FUNÇÕES AUXILIARES ---

// Popular banco inicial
async function initializeCharacters() {
    const count = await Character.countDocuments();
    if (count === 0) {
        await Character.insertMany([
            { name: "Pio XIII", img: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Pius_XII_1950s.jpg/220px-Pius_XII_1950s.jpg", owner: null },
            { name: "Voiello", img: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Portrait_of_Cardinal_Mazarin.jpg/220px-Portrait_of_Cardinal_Mazarin.jpg", owner: null }
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

// Emitir histórico de chat (NOVO)
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
    socket.on('claim_character', async (data) => {
        const result = await Character.findOneAndUpdate(
            { _id: data.charId, owner: null },
            { owner: data.playerId },
            { new: true }
        );
        if (result) emitUpdatedList(io);
    });

    socket.on('release_character', async (data) => {
        const result = await Character.findOneAndUpdate(
            { _id: data.charId, owner: data.playerId },
            { owner: null },
            { new: true }
        );
        if (result) emitUpdatedList(io);
    });

    socket.on('create_character', async (newChar) => {
        await Character.create({ ...newChar, owner: null });
        emitUpdatedList(io);
    });

    socket.on('delete_character', async (charId) => {
        await Character.findByIdAndDelete(charId);
        emitUpdatedList(io);
    });

    // --- Lógica do Chat (NOVO) ---
    socket.on('send_message', async (data) => {
        // data = { playerId: 1, text: "Olá" }
        
        // 1. Descobrir quem o jogador está interpretando AGORA
        // Buscamos um personagem que tenha este 'owner'
        const activeChar = await Character.findOne({ owner: data.playerId });
        
        // Se tiver personagem, usa o nome dele. Se não, usa "Jogador X"
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