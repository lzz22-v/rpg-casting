const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

// NOVOS IMPORTS DE SEGURANÇA
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// NOVO: Importa Cloudinary (Mantido)
const cloudinary = require('cloudinary').v2;

// --- CONFIGURAÇÃO DO MONGODB ---
const uri = "mongodb+srv://luizvale132_db_user:R04cTRkJ4GgOYdPb@cluster0.flnqilb.mongodb.net/project0?retryWrites=true&w=majority";

mongoose.connect(uri)
    .then(() => console.log('Conectado ao MongoDB Atlas com sucesso!'))
    .catch(err => console.error('Erro na conexão com MongoDB:', err));

// --- CONFIGURAÇÃO DO CLOUDINARY (Substitua estas chaves) ---
cloudinary.config({
    cloud_name: 'SEU_CLOUD_NAME_AQUI', 
    api_key: 'SEU_API_KEY_AQUI',      
    api_secret: 'SEU_API_SECRET_AQUI'  
});

// --- MODELOS DE DADOS (SCHEMAS) ---

// NOVO: 3. Modelo de Usuário (User)
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Armazenado com Hash
    createdAt: { type: Date, default: Date.now }
});

// Pré-salvamento: Faz o hash da senha antes de salvar
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Método para comparar a senha no login
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);

// NOVO: 4. Modelo de Sala (Room)
const roomSchema = new mongoose.Schema({
    roomCode: { type: String, required: true, unique: true }, // A CHAVE de acesso
    roomName: { type: String, required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Quem criou
    createdAt: { type: Date, default: Date.now }
});
const Room = mongoose.model('Room', roomSchema);


// 1. Personagens (Atualizado com roomId)
const characterSchema = new mongoose.Schema({
    name: { type: String, required: true },
    img: { type: String, required: true }, 
    owner: { type: Number, default: null },
    active: { type: Boolean, default: false },
    // NOVO: Chave estrangeira para a Sala
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true } 
});
const Character = mongoose.model('Character', characterSchema);


// 2. Mensagens do Chat (Atualizado com roomId)
const messageSchema = new mongoose.Schema({
    playerId: Number, 
    senderName: String,
    text: String,
    timestamp: { type: Date, default: Date.now },
    // NOVO: Chave estrangeira para a Sala
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true } 
});
const Message = mongoose.model('Message', messageSchema);


// --- FUNÇÕES AUXILIARES ---

// NOVO: Geração de Token JWT
const generateToken = (id) => {
    return jwt.sign({ id }, 'SEGREDO_SUPER_FORTE_AQUI', { // Substitua o segredo em produção
        expiresIn: '30d', 
    });
};

// NOVO: Geração de Código de Sala
function generateRoomCode(length = 6) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}


// Função para upload de Base64 para Cloudinary (Mantida)
async function uploadImageToCloudinary(imageBase64Data) {
    try {
        const result = await cloudinary.uploader.upload(imageBase64Data, {
            folder: "rpg_project", 
            resource_type: "image"
        });
        // Dica: Use transformações para otimizar o tamanho da URL de retorno, por exemplo:
        return cloudinary.url(result.public_id, {
            width: 80, 
            height: 80, 
            crop: "fill", 
            fetch_format: "auto"
        });
    } catch (error) {
        console.error("Erro ao fazer upload para o Cloudinary:", error);
        return `https://via.placeholder.com/150/ff0000/ffffff?text=Falha`; 
    }
}


// Função para garantir que apenas UM personagem esteja 'active: true' NA SALA CORRETA
async function deactivatePreviousCharacter(playerId, currentActiveCharId, roomId) {
    await Character.updateMany(
        { owner: playerId, active: true, _id: { $ne: currentActiveCharId }, roomId: roomId },
        { active: false }
    );
}

// Popular banco inicial (AGORA INICIALIZA UMA SALA E PERSONAGENS TESTE)
async function initializeCharacters() {
    const roomCount = await Room.countDocuments();
    if (roomCount === 0) {
        // Cria um usuário e uma sala inicial para testes
        const user = await User.create({ username: 'gm_default', password: 'password' });
        const defaultRoom = await Room.create({
            roomName: 'Sala de Teste Inicial',
            ownerId: user._id,
            roomCode: 'DEV001'
        });
        
        await Character.insertMany([
            { name: "Pio XIII", img: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Pius_XII_1950s.jpg/220px-Pius_XII_1950s.jpg", owner: null, active: false, roomId: defaultRoom._id },
            { name: "Voiello", img: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Portrait_of_Cardinal_Mazarin.jpg/220px-Portrait_of_Cardinal_Mazarin.jpg", owner: null, active: false, roomId: defaultRoom._id }
        ]);
        console.log(`Personagens e Sala de Teste (DEV001) criados. Login: gm_default/password`);
    } else {
        console.log('Salas e personagens existentes no DB.');
    }
}
mongoose.connection.once('open', initializeCharacters);


// Emitir lista de personagens (ATUALIZADO: Filtra por Sala)
const emitUpdatedList = async (socketOrIo, roomId) => {
    const characters = await Character.find({ roomId: roomId });
    socketOrIo.emit('update_list', characters);
};

// Emitir histórico de chat (ATUALIZADO: Filtra por Sala)
const emitChatHistory = async (socket, roomId) => {
    const messages = await Message.find({ roomId: roomId }).sort({ timestamp: 1 }).limit(50);
    socket.emit('chat_history', messages);
};

// --- ROTAS EXPRESS (PARA LOGIN/CADASTRO/CRIAÇÃO DE SALA) ---
app.use(express.json()); // NECESSÁRIO para ler o corpo (body) das requisições POST

// POST /api/users/register
app.post('/api/users/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Dados inválidos.' });

    const userExists = await User.findOne({ username });
    if (userExists) return res.status(400).json({ message: 'Nome de usuário já existe.' });

    const user = await User.create({ username, password });
    
    res.status(201).json({
        _id: user._id,
        username: user.username,
        token: generateToken(user._id),
    });
});

// POST /api/users/login
app.post('/api/users/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (user && (await user.matchPassword(password))) {
        res.json({
            _id: user._id,
            username: user.username,
            token: generateToken(user._id),
        });
    } else {
        res.status(401).json({ message: 'Credenciais inválidas.' });
    }
});

// POST /api/rooms/create
app.post('/api/rooms/create', async (req, res) => {
    // É recomendado usar um middleware para extrair ownerId do JWT, mas simplificamos aqui:
    const { roomName, ownerId } = req.body; 

    if (!roomName || !ownerId) return res.status(400).json({ message: 'Dados incompletos.' });

    let roomCode;
    let roomExists = true;
    
    // Garante que a chave é única
    while (roomExists) {
        roomCode = generateRoomCode();
        roomExists = await Room.findOne({ roomCode });
    }

    const room = await Room.create({ roomName, ownerId, roomCode });

    res.status(201).json({
        roomName: room.roomName,
        roomCode: room.roomCode, 
        roomId: room._id,
        message: 'Sala criada com sucesso! Use o código para entrar.'
    });
});
// FIM DAS ROTAS EXPRESS

app.use(express.static('public'));

// --- LÓGICA DO SOCKET.IO (Adaptada para Salas) ---

io.on('connection', (socket) => {
    console.log('Cliente conectado, aguardando entrada na sala:', socket.id);

    let currentRoomCode = null;
    let currentRoomId = null;

    // NOVO EVENTO: O Cliente solicita entrar em uma Sala
    socket.on('join_room', async (data) => {
        const { roomCode, playerId } = data; // playerId é o J1 ou J2
        const room = await Room.findOne({ roomCode: roomCode });

        if (!room) {
            socket.emit('room_error', 'Sala não encontrada. Verifique o código.');
            return;
        }

        // Entra na sala do Socket.IO
        currentRoomCode = roomCode;
        currentRoomId = room._id;
        socket.join(roomCode);
        
        console.log(`Jogador ${playerId} entrou na sala: ${roomCode}`);
        socket.emit('room_joined', { roomName: room.roomName, roomCode: roomCode, playerId: playerId });

        // Envia dados iniciais *SOMENTE* para quem acabou de entrar
        emitUpdatedList(socket, currentRoomId);
        emitChatHistory(socket, currentRoomId);
    });

    // --- Lógica de Personagens (ADAPTADA) ---
    // (Todas as operações agora usam currentRoomId para filtrar e currentRoomCode para emitir)

    const checkRoom = () => {
        if (!currentRoomId || !currentRoomCode) {
            socket.emit('room_error', 'Você precisa estar em uma sala para realizar esta ação.');
            return false;
        }
        return true;
    };
    
    // 1. Assumir Posse
    socket.on('claim_character', async (data) => {
        if (!checkRoom()) return;

        const result = await Character.findOneAndUpdate(
            { _id: data.charId, owner: null, roomId: currentRoomId }, // Filtra por sala
            { owner: data.playerId, active: true },
            { new: true }
        );
        if (result) {
            await deactivatePreviousCharacter(data.playerId, data.charId, currentRoomId); // Passa roomId
            emitUpdatedList(io.to(currentRoomCode), currentRoomId); // Emite SOMENTE para a sala
        }
    });

    // 2. Definir Personagem Ativo
    socket.on('set_active', async (data) => {
        if (!checkRoom()) return;
        
        await deactivatePreviousCharacter(data.playerId, data.charId, currentRoomId); // Passa roomId
        const result = await Character.findOneAndUpdate(
            { _id: data.charId, owner: data.playerId, roomId: currentRoomId }, // Filtra por sala
            { active: true },
            { new: true }
        );
        if (result) emitUpdatedList(io.to(currentRoomCode), currentRoomId); // Emite SOMENTE para a sala
    });
    
    // 3. Deixar Posse
    socket.on('release_character', async (data) => {
        if (!checkRoom()) return;
        
        const result = await Character.findOneAndUpdate(
            { _id: data.charId, owner: data.playerId, roomId: currentRoomId }, // Filtra por sala
            { owner: null, active: false },
            { new: true }
        );
        if (result) emitUpdatedList(io.to(currentRoomCode), currentRoomId); // Emite SOMENTE para a sala
    });

    // 4. Criar Personagem 
    socket.on('create_character', async (newChar) => {
        if (!checkRoom()) return;

        let imgUrl = newChar.img;
        
        if (imgUrl.startsWith('data:image')) {
            imgUrl = await uploadImageToCloudinary(imgUrl);
        }

        await Character.create({ 
            name: newChar.name, 
            img: imgUrl, 
            owner: null, 
            active: false,
            roomId: currentRoomId // SALVA COM O ID DA SALA
        });
        emitUpdatedList(io.to(currentRoomCode), currentRoomId); // Emite SOMENTE para a sala
    });

    // 5. Deletar Personagem
    socket.on('delete_character', async (charId) => {
        if (!checkRoom()) return;
        
        await Character.findByIdAndDelete(charId); // Melhoria: deveria verificar se o usuário é dono ou GM
        emitUpdatedList(io.to(currentRoomCode), currentRoomId); // Emite SOMENTE para a sala
    });

    // --- Lógica do Chat (ADAPTADA) ---
    socket.on('send_message', async (data) => {
        if (!checkRoom()) return;
        
        const activeChar = await Character.findOne({ owner: data.playerId, active: true, roomId: currentRoomId }); // Filtra por sala
        const displayName = activeChar ? activeChar.name : `Jogador ${data.playerId}`;

        const newMessage = await Message.create({
            playerId: data.playerId,
            senderName: displayName,
            text: data.text,
            roomId: currentRoomId // SALVA COM O ID DA SALA
        });

        io.to(currentRoomCode).emit('receive_message', newMessage); // Emite SOMENTE para a sala
    });

    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
        // Lógica futura: Atualizar a lista de jogadores online na sala
    });
});

http.listen(3000, () => {
    console.log('Servidor rodando na porta 3000');
});