const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

// A URI DE CONEXÃO FINAL COM USUÁRIO E SENHA
const uri = "mongodb+srv://luizvale132_db_user:R04cTRkJ4GgOYdPb@cluster0.flnqilb.mongodb.net/project0?retryWrites=true&w=majority";

// --- 1. CONEXÃO E MODELO ---
mongoose.connect(uri)
    .then(() => console.log('Conectado ao MongoDB Atlas com sucesso!'))
    .catch(err => console.error('Erro na conexão com MongoDB:', err));

// Definição do Esquema (Schema) para o Mongoose
const characterSchema = new mongoose.Schema({
    // Removido o 'id' pois o MongoDB gera '_id' automaticamente
    name: { type: String, required: true },
    img: { type: String, required: true },
    owner: { type: Number, default: null } // 1 ou 2, ou null
});
const Character = mongoose.model('Character', characterSchema);

// --- 2. FUNÇÕES AUXILIARES ---

// Função para popular o banco com os personagens iniciais (apenas se estiver vazio)
async function initializeCharacters() {
    const count = await Character.countDocuments();
    if (count === 0) {
        await Character.insertMany([
            { name: "Pio XIII", img: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Pius_XII_1950s.jpg/220px-Pius_XII_1950s.jpg", owner: null },
            { name: "Voiello", img: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Portrait_of_Cardinal_Mazarin.jpg/220px-Portrait_of_Cardinal_Mazarin.jpg", owner: null }
        ]);
        console.log('Personagens iniciais criados no banco.');
    }
}
// Garante que a lista inicial exista após a conexão
mongoose.connection.once('open', () => {
    initializeCharacters();
});

// Função centralizada para buscar a lista e emitir a atualização para todos
const emitUpdatedList = async () => {
    // Busca todos os personagens no MongoDB
    const characters = await Character.find({});
    io.emit('update_list', characters);
};

// Servir os arquivos da pasta 'public'
app.use(express.static('public'));

// --- 3. LÓGICA DO SOCKET.IO (USANDO ASYNC/AWAIT) ---

io.on('connection', (socket) => {
    console.log('Um jogador conectou: ' + socket.id);

    // 1. Assim que conectar, enviar a lista atual para ele
    // Note que chamamos a função assíncrona
    emitUpdatedList();

    // 2. Ouvir quando alguém assume um personagem
    // Usamos 'async' para poder usar await dentro
    socket.on('claim_character', async (data) => {
        // charId agora é o ID único (_id) do MongoDB
        const charId = data.charId;
        const playerId = data.playerId;

        // Tenta encontrar e atualizar APENAS se o 'owner' for null
        const result = await Character.findOneAndUpdate(
            { _id: charId, owner: null },
            { owner: playerId },
            { new: true } // Retorna o documento APÓS a atualização
        );

        if (result) {
            emitUpdatedList(); // Avisa TODO MUNDO
        }
    });

    // 3. Ouvir quando alguém larga o personagem
    socket.on('release_character', async (data) => {
        const charId = data.charId;
        const playerId = data.playerId;

        // Tenta encontrar e atualizar APENAS se o 'owner' for o playerId
        const result = await Character.findOneAndUpdate(
            { _id: charId, owner: playerId },
            { owner: null },
            { new: true }
        );

        if (result) {
            emitUpdatedList();
        }
    });

    // 4. Ouvir criação de personagem
    socket.on('create_character', async (newChar) => {
        // Criar um novo documento no banco. O MongoDB cuidará do ID e 'owner: null'
        await Character.create({
            name: newChar.name,
            img: newChar.img,
            owner: null // Garante que comece livre
        });
        emitUpdatedList();
    });

    // 5. Ouvir exclusão
    socket.on('delete_character', async (charId) => {
        // Deleta o documento com o ID correspondente
        await Character.findByIdAndDelete(charId);
        emitUpdatedList();
    });
});

// Rodar na porta 3000
http.listen(3000, () => {
    console.log('Servidor rodando em http://localhost:3000');
});