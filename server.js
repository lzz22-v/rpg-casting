const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');
// NOVO: Importa Cloudinary
const cloudinary = require('cloudinary').v2;

// --- CONFIGURAÇÃO DO MONGODB ---
const uri = "mongodb+srv://luizvale132_db_user:R04cTRkJ4GgOYdPb@cluster0.flnqilb.mongodb.net/project0?retryWrites=true&w=majority";

mongoose.connect(uri)
    .then(() => console.log('Conectado ao MongoDB Atlas com sucesso!'))
    .catch(err => console.error('Erro na conexão com MongoDB:', err));

// --- CONFIGURAÇÃO DO CLOUDINARY (Substitua estas chaves) ---
cloudinary.config({
    cloud_name: 'SEU_CLOUD_NAME_AQUI', // **SUBSTITUA**
    api_key: 'SEU_API_KEY_AQUI',      // **SUBSTITUA**
    api_secret: 'SEU_API_SECRET_AQUI'  // **SUBSTITUA**
});

// --- MODELOS DE DADOS (SCHEMAS) ---

// 1. Personagens
const characterSchema = new mongoose.Schema({
    name: { type: String, required: true },
    img: { type: String, required: true }, // Agora armazena a URL otimizada do Cloudinary
    owner: { type: Number, default: null },
    active: { type: Boolean, default: false }
});
const Character = mongoose.model('Character', characterSchema);

// 2. Mensagens do Chat
const messageSchema = new mongoose.Schema({
    playerId: Number, 
    senderName: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);


// --- FUNÇÕES AUXILIARES ---

// NOVO: Função para upload de Base64 para Cloudinary
async function uploadImageToCloudinary(imageBase64Data) {
    try {
        // O Cloudinary aceita o string Base64 e o otimiza
        const result = await cloudinary.uploader.upload(imageBase64Data, {
            folder: "rpg_project", 
            resource_type: "image"
        });
        return result.secure_url; 
    } catch (error) {
        console.error("Erro ao fazer upload para o Cloudinary:", error);
        return `https://via.placeholder.com/150/ff0000/ffffff?text=Falha`; 
    }
}


// Função para garantir que apenas UM personagem esteja 'active: true'
async function deactivatePreviousCharacter(playerId, currentActiveCharId) {
    await Character.updateMany(
        { owner: playerId, active: true, _id: { $ne: currentActiveCharId } },
        { active: false }
    );
}

// Popular banco inicial (Mantido como está, usando URLs)
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
    
    // 1. Assumir Posse
    socket.on('claim_character', async (data) => {
        const result = await Character.findOneAndUpdate(
            { _id: data.charId, owner: null },
            { owner: data.playerId, active: true },
            { new: true }
        );
        if (result) {
            await deactivatePreviousCharacter(data.playerId, data.charId);
            emitUpdatedList(io);
        }
    });

    // 2. Definir Personagem Ativo
    socket.on('set_active', async (data) => {
        await deactivatePreviousCharacter(data.playerId, data.charId);
        const result = await Character.findOneAndUpdate(
            { _id: data.charId, owner: data.playerId },
            { active: true },
            { new: true }
        );
        if (result) emitUpdatedList(io);
    });
    
    // 3. Deixar Posse
    socket.on('release_character', async (data) => {
        const result = await Character.findOneAndUpdate(
            { _id: data.charId, owner: data.playerId },
            { owner: null, active: false },
            { new: true }
        );
        if (result) emitUpdatedList(io);
    });

    // 4. Criar Personagem (ATUALIZADO PARA CLOUDINARY)
    socket.on('create_character', async (newChar) => {
        let imgUrl = newChar.img; // Recebe Base64 ou URL placeholder
        
        // Se a imagem enviada for o Base64 pesado, faz o upload para otimizar
        if (imgUrl.startsWith('data:image')) {
            imgUrl = await uploadImageToCloudinary(imgUrl);
        }

        // Salva a URL otimizada (ou o placeholder URL)
        await Character.create({ 
            name: newChar.name, 
            img: imgUrl, // SALVA URL LEVE
            owner: null, 
            active: false 
        });
        emitUpdatedList(io);
    });

    // 5. Deletar Personagem
    socket.on('delete_character', async (charId) => {
        // Melhoria futura: Adicionar lógica para deletar a imagem do Cloudinary também
        await Character.findByIdAndDelete(charId);
        emitUpdatedList(io);
    });

    // --- Lógica do Chat (Mantida) ---
    socket.on('send_message', async (data) => {
        const activeChar = await Character.findOne({ owner: data.playerId, active: true });
        const displayName = activeChar ? activeChar.name : `Jogador ${data.playerId}`;

        const newMessage = await Message.create({
            playerId: data.playerId,
            senderName: displayName,
            text: data.text
        });

        io.emit('receive_message', newMessage);
    });
});

http.listen(3000, () => {
    console.log('Servidor rodando na porta 3000');
});