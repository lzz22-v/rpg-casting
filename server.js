// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Servir os arquivos da pasta 'public'
app.use(express.static('public'));

// --- ESTADO INICIAL DOS DADOS ---
// Esta lista agora vive no servidor, não no navegador de cada um
let characters = [
    { id: 1, name: "Pio XIII", img: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Pius_XII_1950s.jpg/220px-Pius_XII_1950s.jpg", owner: null },
    { id: 2, name: "Voiello", img: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Portrait_of_Cardinal_Mazarin.jpg/220px-Portrait_of_Cardinal_Mazarin.jpg", owner: 2 }
];

io.on('connection', (socket) => {
    console.log('Um jogador conectou: ' + socket.id);

    // 1. Assim que conectar, enviar a lista atual para ele
    socket.emit('update_list', characters);

    // 2. Ouvir quando alguém assume um personagem
    socket.on('claim_character', (data) => {
        // data = { charId: 1, playerId: 1 }
        const char = characters.find(c => c.id === data.charId);
        if (char && char.owner === null) { // Validação de segurança
            char.owner = data.playerId;
            io.emit('update_list', characters); // Avisa TODO MUNDO
        }
    });

    // 3. Ouvir quando alguém larga o personagem
    socket.on('release_character', (data) => {
        const char = characters.find(c => c.id === data.charId);
        // Só permite soltar se for o dono
        if (char && char.owner === data.playerId) { 
            char.owner = null;
            io.emit('update_list', characters);
        }
    });

    // 4. Ouvir criação de personagem
    socket.on('create_character', (newChar) => {
        // Gera ID seguro no servidor
        const newId = characters.length > 0 ? Math.max(...characters.map(c => c.id)) + 1 : 1;
        newChar.id = newId;
        newChar.owner = null;
        
        characters.push(newChar);
        io.emit('update_list', characters);
    });

    // 5. Ouvir exclusão
    socket.on('delete_character', (charId) => {
        characters = characters.filter(c => c.id !== charId);
        io.emit('update_list', characters);
    });
});

// Rodar na porta 3000
http.listen(3000, () => {
    console.log('Servidor rodando em http://localhost:3000');
});