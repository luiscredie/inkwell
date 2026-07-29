#!/usr/bin/env python3
"""Refine and audit Inkwell's Brazilian Portuguese card overlay.

This tool is deliberately conservative:

* card_id, ability_id, ability_count and source_fingerprint are immutable;
* card names are never translated;
* exact recurring rules and keyword reminders use a translation memory;
* common machine-translation defects are repaired deterministically;
* anything still suspicious is reported for editorial review.

It does not call an online translator and never invents card mechanics.
"""

from __future__ import annotations

import argparse
import collections
import copy
import datetime as dt
import hashlib
import json
import math
import re
import unicodedata
from pathlib import Path
from typing import Any, Iterable


GAME_TOKEN_RE = re.compile(r"\{[^{}]+\}|[⟳⬡¤◊※]")
STRONG_ENGLISH_RE = re.compile(
    r"\b(?:this|that|your|you|chosen|character|characters|damage|deal|dealt|"
    r"hand|turn|played|playing|banish|banished|challenge|challenged|"
    r"opponent|opposing|whenever|until|during|another|facedown|faceup|"
    r"return|reveal|draw|discard|ready|exerted|exert|reduced)\b",
    re.IGNORECASE,
)


# Exact, high-confidence translations for the most common complete rules texts.
# These entries intentionally favor terminology used by Brazilian Lorcana players.
EXACT_TRANSLATIONS: dict[str, str] = {
    "Evasive (Only characters with Evasive can challenge this character.)":
        "Evasivo (Somente personagens com Evasivo podem desafiar este personagem.)",
    "Support (Whenever this character quests, you may add their {s} to another chosen character's {s} this turn.)":
        "Apoio (Sempre que este personagem buscar Lore, você pode adicionar o {s} dele ao {s} de outro personagem escolhido neste turno.)",
    "Rush (This character can challenge the turn they're played.)":
        "Ímpeto (Este personagem pode desafiar no turno em que é jogado.)",
    "Bodyguard (This character may enter play exerted. An opposing character who challenges one of your characters must choose one with Bodyguard if able.)":
        "Guarda-costas (Este personagem pode entrar em jogo exertado. Um personagem adversário que desafiar um de seus personagens deve escolher um com Guarda-costas, se possível.)",
    "Ward (Opponents can't choose this character except to challenge.)":
        "Proteção (Os adversários não podem escolher este personagem, exceto para desafiá-lo.)",
    "Reckless (This character can't quest and must challenge each turn if able.)":
        "Imprudente (Este personagem não pode buscar Lore e deve desafiar a cada turno, se possível.)",
    "Alert (This character can challenge as if they had Evasive.)":
        "Alerta (Este personagem pode desafiar como se tivesse Evasivo.)",
    "Vanish (When an opponent chooses this character for an action, banish them.)":
        "Desvanecer (Quando um adversário escolher este personagem para uma ação, bana este personagem.)",
    "Draw a card.": "Compre uma carta.",
    "Draw 2 cards.": "Compre 2 cartas.",
    "Draw 3 cards.": "Compre 3 cartas.",
    "Ward": "Proteção",
}


# Hand-reviewed repairs for source rows whose symbols/text were corrupted by the
# previous machine-translation pass. These are keyed by stable ability_id so a
# future source change cannot silently reuse the correction.
ABILITY_OVERRIDES: dict[str, str] = {
    "DLPC1-20-P2-A2": "ESTOU ADORANDO ISTO: Se um efeito fizer com que você descarte uma ou mais cartas, você não as descarta.",
    "DLPC1-3-C1-A2": "Resistir +2 (O dano causado a este personagem é reduzido em 2.) A ESPADA CANTANTE: Sempre que você jogar uma canção, este personagem pode desafiar personagens preparados neste turno.",
    "LOR1-136-A1": "ENCANTAMENTO FINAL — Bana este item — Bana o personagem Vilão escolhido.",
    "LOR1-196-A1": "Bana o item escolhido.",
    "LOR10-131-A1": "Bana um personagem escolhido seu para comprar 2 cartas. Se esse personagem tinha uma carta sob ele, compre 3 cartas em vez disso.",
    "LOR10-14-A1": "SEGURE SEUS CAVALOS: Este personagem entra em jogo exertado.",
    "LOR10-83-A1": "FORA DO MAPA: Quando você jogar este personagem, você pode banir o local escolhido.",
    "LOR11-101-A2": "ABRIR CAMINHO {e}, Bana este item — Bana o local escolhido.",
    "LOR11-97-A2": "Evasivo até o início do seu próximo turno. (Somente personagens com Evasivo podem desafiá-lo.) — Bana o personagem com dano escolhido.",
    "LOR12-181-A1": "AGUENTAR FIRME: Este personagem pode entrar em jogo exertado para dar Resistir +2 ao personagem escolhido até o início do seu próximo turno. (O dano causado a ele é reduzido em 2.)",
    "LOR12-190-A2": "ELETROARMADURA Enquanto houver uma carta sob este personagem, ele ganha Resistir +2. (O dano causado a ele é reduzido em 2.)",
    "LOR12-96-A1": "Bana o item ou local escolhido e todos os outros itens ou locais com o mesmo nome.",
    "LOR2-101-A1": "Bana o personagem com dano escolhido.",
    "LOR2-131-A1": "(Um personagem com custo 3 ou mais pode {e} para cantar esta canção sem pagar o custo.) Bana um personagem Vilão escolhido seu para banir o personagem escolhido.",
    "LOR2-164-A1": "Bana um item escolhido seu para causar 5 de dano ao personagem escolhido.",
    "LOR2-177-A2": "Resistir +2 (O dano causado a este personagem é reduzido em 2.) A ESPADA CANTANTE: Sempre que você jogar uma canção, este personagem pode desafiar personagens preparados neste turno.",
    "LOR2-181-A1": "Transformar 4 (Você pode pagar 4 {i} para jogar esta carta sobre um de seus personagens chamado Hercules.)\nResistir +2 (O dano causado a este personagem é reduzido em 2.)",
    "LOR2-185-A1": "Resistir +1 (O dano causado a este personagem é reduzido em 1.)\nLÍDER DOS BATEDORES: Durante seu turno, sempre que este personagem banir outro personagem em um desafio, você pode causar 2 de dano ao personagem escolhido.",
    "LOR2-215-A1": "Transformar 4 (Você pode pagar 4 {i} para jogar esta carta sobre um de seus personagens chamado Hercules.)\nResistir +2 (O dano causado a este personagem é reduzido em 2.)",
    "LOR2-23-A1": "NÃO VOU MACHUCAR VOCÊ: Quando você jogar este personagem, você pode remover até 2 de dano do personagem escolhido.",
    "LOR2-41-A1": "Transformar 2 (Você pode pagar 2 {i} para jogar esta carta sobre um de seus personagens chamado Fairy Godmother.) ESQUEÇA A CARRUAGEM, AQUI ESTÁ UMA ESPADA: Sempre que este personagem buscar Lore, seus personagens ganham Desafiante +3 e “Quando este personagem for banido em um desafio, devolva esta carta à sua mão” neste turno. (Eles recebem +3 {s} enquanto desafiam.)",
    "LOR2-44-A1": "Evasivo (Somente personagens com Evasivo podem desafiar este personagem.) AQUELA VOZ CALMA E BAIXA: Quando você jogar este personagem, se tiver um personagem chamado Pinocchio em jogo, você pode comprar uma carta.",
    "LOR3-198-A1": "Bana o local ou item escolhido.",
    "LOR3-212-A1": "QUE NEGÓCIO: Sempre que este personagem cantar uma canção, você pode jogar novamente essa canção do seu descarte sem pagar o custo. Depois, coloque-a no fundo do seu baralho.",
    "LOR3-91-A1": "QUE NEGÓCIO: Sempre que este personagem cantar uma canção, você pode jogar novamente essa canção do seu descarte sem pagar o custo. Depois, coloque-a no fundo do seu baralho.",
    "LOR4-130-A1": "Bana o personagem escolhido com 2 {s} ou menos.",
    "LOR4-166-A1": "DEFESA GELADA: Sempre que você jogar um personagem, ele ganha Resistir +1 até o início do seu próximo turno. (O dano causado a ele é reduzido em 1.)",
    "LOR4-186-A1": "Resistir +1 (O dano causado a este personagem é reduzido em 1.) EXÉRCITO DE VASSOURAS: Este personagem recebe +2 {s} para cada outro personagem chamado Magic Broom que você tiver em jogo.",
    "LOR4-187-A2": "Resistir +1 (O dano causado a este personagem é reduzido em 1.) VARRER: Quando você jogar este personagem, cause ao personagem escolhido uma quantidade de dano igual ao número de personagens Broom que você tem em jogo.",
    "LOR4-198-A1": "Cantar Juntos 10 (Qualquer número de personagens seus ou de seus companheiros de equipe com custo total 10 ou mais pode {e} para cantar esta canção sem pagar o custo.) Cause 3 de dano a até 3 personagens e/ou locais escolhidos.",
    "LOR4-225-E-A2": "Resistir +1 (O dano causado a este personagem é reduzido em 1.) VARRER: Quando você jogar este personagem, cause ao personagem escolhido uma quantidade de dano igual ao número de personagens Broom que você tem em jogo.",
    "LOR4-79-A1": "NEGÓCIO SUSPEITO: Quando você jogar este personagem, escolha e descarte uma carta ou bana este personagem.",
    "LOR5-101-A1": "LAR NA FLORESTA: Seus personagens chamados Robin Hood podem se mover para cá sem pagar o custo. TERRENO FAMILIAR: Enquanto estiverem aqui, os personagens ganham Proteção e “{e}, 1 {i} — Cause 2 de dano ao personagem com dano escolhido”. (Os adversários não podem escolhê-los, exceto para desafiá-los.)",
    "LOR5-130-A1": "Bana um personagem escolhido seu para banir o personagem escolhido.",
    "LOR5-98-A1": "VOCÊ PARECE DA REALEZA: Se você tiver um personagem chamado Prince John em jogo, paga 1 {i} a menos para jogar este item.",
    "LOR6-15-A1": "Apoio (Sempre que este personagem buscar Lore, você pode adicionar o {s} dele ao {s} de outro personagem escolhido neste turno.) PRECISA DE AJUDA?: No fim do seu turno, você pode preparar outro personagem escolhido seu.",
    "LOR6-190-A1": "EU QUEBRO COISAS: Sempre que este personagem buscar Lore, você pode banir o item ou local escolhido para ganhar 2 de Lore.",
    "LOR6-191-A1": "Resistir +1 (O dano causado a este personagem é reduzido em 1.) SUBIR DE NÍVEL: Durante seu turno, sempre que este personagem banir outro personagem em um desafio, ganhe 2 de Lore.",
    "LOR6-194-A2": "Resistir +2 (O dano causado a este personagem é reduzido em 2.) NÃO FIQUE AÍ PARADO!: No início do seu turno, cause 1 de dano a cada personagem adversário preparado.",
    "LOR6-220-A1": "EU QUEBRO COISAS: Sempre que este personagem buscar Lore, você pode banir o item ou local escolhido para ganhar 2 de Lore.",
    "LOR7-114-A2": "PLANO ASSUSTADOR: Enquanto este personagem estiver exertado, personagens adversários não podem se exertar para cantar canções, e seus personagens Pirata ganham Resistir +1. (O dano causado a eles é reduzido em 1.)",
    "LOR7-138-A1": "COMO ISSO ACONTECEU?: Quando você jogar este personagem, você pode banir um item escolhido seu para comprar uma carta. Se o item banido se chamar Maurice's Machine, você também pode banir o personagem escolhido com 2 {s} ou menos.",
    "LOR7-136-A1": "JÁ CHEGA!: {e}, 2 {i}, Bana 2 de seus itens — Cause 5 de dano ao personagem escolhido.",
    "LOR7-157-A1": "VIM COBRAR: Sempre que este personagem buscar Lore, você pode banir um item escolhido seu para comprar uma carta.",
    "LOR7-174-A2": "TENHO SEUS QUATRO GRUPOS ALIMENTARES BÁSICOS: Quando você jogar este personagem, o personagem escolhido ganha Resistir +1 até o início do seu próximo turno. (O dano causado a ele é reduzido em 1.)",
    "LOR7-21-A1": "LEALDADE DURADOURA: Quando você jogar este personagem, você pode remover até 2 de dano do personagem escolhido, e ele ganha Resistir +1 até o início do seu próximo turno. (O dano causado a ele é reduzido em 1.)",
    "LOR7-63-A2": "ESTOU ADORANDO ISTO: Se um efeito fizer com que você descarte uma ou mais cartas, você não as descarta.",
    "LOR7-93-A1": "FORCE-OS A AGIR: Sempre que este personagem buscar Lore, personagens adversários com dano ganham Imprudente durante o próximo turno deles. (Eles não podem buscar Lore e devem desafiar, se possível.)",
    "LOR8-204-A1": "AGUENTAR OS GOLPES: {e}, 1 {i} — O personagem escolhido sem dano ganha Resistir +2 até o início do seu próximo turno. (O dano causado a ele é reduzido em 2.)",
    "LOR8-30-A2": "BOLA ÉPICA DE INCRÍVEL Enquanto este personagem não tiver dano, ele ganha Resistir +2. (O dano causado a ele é reduzido em 2.)",
    "LOR9-202-A1": "Cantar Juntos 10 (Qualquer número de personagens seus ou de seus companheiros de equipe com custo total 10 ou mais pode {e} para cantar esta canção sem pagar o custo.) Cause 3 de dano a até 3 personagens e/ou locais escolhidos.",
    "LOR9-241-A2": "TCHAU, TCHAU: Sempre que este personagem buscar Lore, você pode banir o personagem exertado escolhido com 5 {s} ou mais.",
    "LOR9-5-A2": "TCHAU, TCHAU: Sempre que este personagem buscar Lore, você pode banir o personagem exertado escolhido com 5 {s} ou mais.",
    "Q1-225-A2": "Resistir +1 (O dano causado a este personagem é reduzido em 1.) VARRER: Quando você jogar este personagem, cause ao personagem escolhido uma quantidade de dano igual ao número de personagens Broom que você tem em jogo.",
    "LOR13-101-A1": "(Um personagem com custo 4 ou mais pode ⟳ para cantar esta canção sem pagar o custo.) Cause 2 de dano a cada personagem adversário que já tenha dano.",
    "LOR13-103-A1": "(Um personagem com custo 4 ou mais pode ⟳ para cantar esta canção sem pagar o custo.) Devolva o personagem ou item escolhido à mão de seu jogador.",
    "LOR13-106-A1": "NOVAS MEMÓRIAS ⟳, 1 ⬡ — Revele a carta do topo do seu baralho. Se ela não for uma carta de personagem ou for uma carta de personagem chamada Kevin, coloque-a em sua mão. Caso contrário, coloque-a no fundo do seu baralho.",
    "LOR13-107-A1": "CASCA FRÁGIL Este item entra em jogo exertado. REGENERAR ⟳, 1 ⬡ — Bana um personagem escolhido seu. Você pode jogar, sem pagar o custo, um personagem com o mesmo nome do personagem banido.",
    "LOR13-134-A1": "Cantar Juntos 7 (Qualquer número de personagens seus ou de seus companheiros de equipe com custo total 7 ou mais pode ⟳ para cantar esta canção sem pagar o custo.) Bana o personagem escolhido.",
    "LOR13-136-A1": "O personagem escolhido recebe +3 ¤ neste turno.",
    "LOR13-138-A1": "(Um personagem com custo 2 ou mais pode ⟳ para cantar esta canção sem pagar o custo.) Prepare o personagem escolhido. Ele não pode buscar Lore pelo restante deste turno.",
    "LOR13-139-A1": "GRITOS ERRÁTICOS ⟳, 2 ⬡ — Exerte todas as cartas do seu tinteiro. Exerte um personagem adversário escolhido com 2 ¤ ou menos.",
    "LOR13-140-A1": "FLUTUAR Quando você jogar este item, escolha um local seu. Enquanto este item estiver em jogo, esse local ganha Evasivo. (Somente personagens com Evasivo podem desafiá-lo.) FORA DE VISTA 3 ⬡ — Devolva este item à sua mão.",
    "LOR13-168-A1": "(Um personagem com custo 3 ou mais pode ⟳ para cantar esta canção sem pagar o custo.) Coloque o item ou local escolhido no tinteiro de seu jogador com a face para baixo e exertado.",
    "LOR13-169-A1": "O personagem escolhido recebe -3 ¤ neste turno.",
    "LOR13-170-A1": "TOC, TOC Este item entra em jogo exertado. QUEM ESTÁ AÍ? ⟳, 2 ⬡ — Olhe as 3 cartas do topo do seu baralho. Você pode revelar uma carta de personagem, item ou local com custo 6 ou menos e jogá-la sem pagar o custo. Coloque o restante no fundo do seu baralho em qualquer ordem. Coloque esta carta em seu tinteiro com a face para baixo e exertada.",
    "LOR13-171-A1": "FLORESCIMENTO REJUVENESCEDOR ⟳ — Remova até 2 de dano do personagem escolhido. Se houver uma carta sob esse personagem, ele ganha Resistir +1 até o início do seu próximo turno. (O dano causado a ele é reduzido em 1.)",
    "LOR13-172-A1": "IMITADOR ⟳ — Coloque a carta do topo do seu baralho em seu tinteiro com a face para baixo e exertada. O adversário escolhido pode colocar a carta do topo do próprio baralho em seu tinteiro com a face para baixo e exertada.",
    "LOR13-173-A1": "VOCÊ É MEU AMIGO ⟳, 1 ⬡ — O personagem escolhido recebe +1 ◊ e ganha Apoio neste turno. (Sempre que ele buscar Lore, você pode adicionar o ¤ dele ao ¤ de outro personagem escolhido neste turno.)",
    "LOR13-174-A1": "INVOCAR HUNNY ⟳, 2 ⬡ — Revele a carta do topo do seu baralho. Se for uma carta Hunny, coloque-a em sua mão. Caso contrário, coloque-a no fundo do seu baralho.",
    "LOR13-204-A1": "EQUIPAMENTO ENCONTRADO ⟳ — Se você descartou uma carta neste turno, um personagem escolhido seu ganha Resistir +1 até o início do seu próximo turno. (O dano causado a ele é reduzido em 1.)",
    "LOR13-205-A1": "PODER TOTAL ⟳, 1 ⬡ — O personagem escolhido ganha Desafiante +2 neste turno. (Ele recebe +2 ¤ enquanto desafia.) CORTE LIMPO 2 ⬡, Bana este item — Bana o personagem Vineling escolhido.",
    "LOR13-206-A1": "METAMORFOSE ⟳, 1 ⬡ — Se um personagem foi banido em um desafio neste turno, compre uma carta.",
    "LOR13-32-A1": "(Um personagem com custo 3 ou mais pode ⟳ para cantar esta canção sem pagar o custo.) Você e outro jogador escolhido compram 2 cartas cada.",
    "LOR13-33-A1": "Cantar Juntos 5 (Qualquer número de personagens seus ou de seus companheiros de equipe com custo total 5 ou mais pode ⟳ para cantar esta canção sem pagar o custo.) Remova até 4 de dano, no total, de qualquer número de seus personagens. Você ganha 1 de Lore para cada 1 de dano removido dessa forma.",
    "LOR13-35-A1": "Cantar Juntos 5 (Qualquer número de personagens seus ou de seus companheiros de equipe com custo total 5 ou mais pode ⟳ para cantar esta canção sem pagar o custo.) Jogue um personagem com custo 4 ou menos sem pagar o custo.",
    "LOR13-36-A1": "AVANCE ⟳, 1 ⬡ — O próximo personagem que você jogar neste turno entra em jogo exertado e ganha Guarda-costas até o início do seu próximo turno. (Um personagem adversário que desafiar um de seus personagens deve escolher um com",
    "LOR13-64-A1": "(Um personagem com custo 2 ou mais pode ⟳ para cantar esta canção sem pagar o custo.) O personagem escolhido ganha Ímpeto e Desafiante +2 neste turno. (Ele pode desafiar no turno em que é jogado. Ele recebe +2 ¤ enquanto desafia.)",
    "LOR13-65-A1": "Cantar Juntos 6 (Qualquer número de personagens seus ou de seus companheiros de equipe com custo total 6 ou mais pode ⟳ para cantar esta canção sem pagar o custo.) O jogador escolhido compra uma carta para cada tipo de tinta diferente entre os personagens que você tem em jogo.",
    "LOR13-70-A1": "PROCESSO DE RENOVAÇÃO ⟳, 1 ⬡ — Coloque uma carta do descarte do jogador escolhido no fundo do baralho dele.",
    "LOR13-71-A1": "PRESENTE DA COLMEIA Uma vez durante seu turno, você pode pagar 1 ⬡ para dar a um personagem escolhido seu a classificação Hunny até o início do seu próximo turno. FEITIÇO DE VELOCIDADE ⟳, 2 ⬡ — Um personagem Hunny escolhido seu ganha Evasivo até o início do seu próximo turno. (Somente personagens com Evasivo podem desafiá-lo.)",
    "LOR13-72-A1": "SIFÃO Sempre que um personagem adversário buscar Lore, você ganha 1 de Lore, a menos que o jogador dele pague 1 ⬡. FLOR RADIANTE ⟳, 2 ⬡ — Ganhe 1 de Lore.",
    "LOR5-194-A1": "Transformar 5 (Você pode pagar 5 ⬡ para jogar esta carta sobre um de seus personagens chamado Arthur.)",
    "LOR5-221-A1": "Transformar 5 (Você pode pagar 5 ⬡ para jogar esta carta sobre um de seus personagens chamado Arthur.)",
    "LOR6-137-A1": "Apoio (Sempre que este personagem buscar Lore, você pode adicionar o ※ dele ao ※ de outro personagem escolhido neste turno.)",
    "Q1-17-A1": "Se você tiver 6 ⬡ ou menos, coloque as 3 cartas do topo do seu baralho em seu tinteiro com a face para baixo. Se você tiver 7 ⬡ ou mais, cada adversário escolhe e bane um dos próprios personagens.",
    "Q1-29-A1": "VANTAGENS DO PODER ⟳ — Compre uma carta.",
    "Q1-31-A1": "AGORA O PODER É MEU ⟳ — Ganhe 1 de Lore.",
    "Q2-12-A1": "VULNERABILIDADE SECRETA Durante o turno dos Iluminadores, cada um pode pagar 3 ⬡ para banir este personagem.",
    "Q2-25-A1": "TOME A COROA! Quando Jafar jogar este item, ele rouba The Reforged Crown. SERPENTE DESMONTADA ⟳, Bana este item — Jafar ganha 2 de Lore.",
    "Q2-27-A1": "AREIA ASCENDENTE ⟳ — Jafar causa 1 de dano a cada personagem adversário.",
}


# Ability headings that remained literally in English after the old translation
# pass. Sound effects, Latin incantations and proper expressions are intentionally
# preserved when that reads better than a forced translation.
ABILITY_NAME_TRANSLATIONS: dict[str, str] = {
    "AD SAXUM COMMUTATE": "AD SAXUM COMMUTATE",
    "AMPED UP": "ENERGIZADO",
    "ANDY'S FAVORITE": "O FAVORITO DE ANDY",
    "BA-BOOM!": "BA-BOOM!",
    "BACKUP": "REFORÇO",
    "BEST MATES": "MELHORES AMIGOS",
    "BIG LIFT": "GRANDE IMPULSO",
    "BLADES OF FURY": "LÂMINAS DA FÚRIA",
    "BRAINSTORM": "TEMPESTADE DE IDEIAS",
    "BREAK APART": "DESMONTAR",
    "CHEEEEHOOOO!": "CHEEEEHOOOO!",
    "CLARION CALL": "CHAMADO DO CLARIM",
    "CLEAR SKIES, CLEAR SKIES": "CÉUS LIMPOS, CÉUS LIMPOS",
    "CLEVER TRAP": "ARMADILHA ENGENHOSA",
    "CONCERT LOVER": "AMANTE DE CONCERTOS",
    "CRASH LANDING": "POUSO FORÇADO",
    "CRIMSON SPARK": "FAÍSCA CARMESIM",
    "CRUEL INTENT": "INTENÇÃO CRUEL",
    "DAUNTLESS": "DESTEMIDO",
    "DEVITALIZER RAY": "RAIO DEVITALIZANTE",
    "DOCTRINA ADDUCERE": "DOCTRINA ADDUCERE",
    "DUCK OF ACTION": "PATO DE AÇÃO",
    "DUSK TO DAWN": "DO ANOITECER AO AMANHECER",
    "ENDLESS TALE": "CONTO SEM FIM",
    "ERODING WINDS": "VENTOS EROSIVOS",
    "EVIL SCHEME": "PLANO MALIGNO",
    "EXTREME FOCUS": "FOCO EXTREMO",
    "FAIL-SAFE": "PLANO DE CONTINGÊNCIA",
    "FLOOD OF POWER": "ONDA DE PODER",
    "FLURRY OF DELIGHT": "RAJADA DE ALEGRIA",
    "FORTUNE HUNTER": "CAÇADOR DE FORTUNAS",
    "FOUND YA": "ACHEI VOCÊ",
    "FREEZE": "CONGELAR",
    "FULL FORCE": "FORÇA TOTAL",
    "GO GET 'EM": "VÁ PEGÁ-LOS",
    "GOLLY!": "GOLLY!",
    "GOTCHA!": "PEGUEI VOCÊ!",
    "GRAB HOLD!": "AGARRE FIRME!",
    "GRASPING TRUNK": "TROMBA PREENSORA",
    "GUARDIAN OF LOST SOULS": "GUARDIÃO DAS ALMAS PERDIDAS",
    "GUESS WHO": "ADIVINHE QUEM",
    "HEAD COCONUT": "CABEÇA DE COCO",
    "HEAVILY ARMED": "FORTEMENTE ARMADO",
    "HEAVILY GUARDED": "FORTEMENTE PROTEGIDO",
    "HIDDEN DEPTHS": "PROFUNDEZAS OCULTAS",
    "HITCH A RIDE": "PEGAR CARONA",
    "HOLD FAST": "SEGURE FIRME",
    "HOLIDAY CHEER": "ALEGRIA FESTIVA",
    "HOPPING IN": "ENTRANDO AOS PULOS",
    "HUNK OF HARDWARE": "PEDAÇO DE METAL",
    "I HEREBY DECREE": "POR ESTE ATO, DECRETO",
    "ICE OVER": "COBRIR DE GELO",
    "ICY BLAST": "EXPLOSÃO GELADA",
    "INCAPACITATE": "INCAPACITAR",
    "INTO THE GLOOM": "RUMO À ESCURIDÃO",
    "JAFAR'S SENTRY": "SENTINELA DE JAFAR",
    "JEALOUS HEART": "CORAÇÃO CIUMENTO",
    "KA-POW!": "KA-POW!",
    "LAND, HO!": "TERRA À VISTA!",
    "LAY OF THE LAND": "CONHECER O TERRENO",
    "LET'S GO HOME": "VAMOS PARA CASA",
    "LET'S RIDE": "VAMOS CAVALGAR",
    "LET'S SHOW 'EM, DUMBO!": "VAMOS MOSTRAR A ELES, DUMBO!",
    "LOOK INNOCENT": "PARECER INOCENTE",
    "LOOT DROP": "ESPÓLIOS",
    "LOW BATTERIES": "BATERIAS FRACAS",
    "MAGICAL INFORMANT": "INFORMANTE MÁGICO",
    "NERDING OUT": "MERGULHO NERD",
    "NO CAPES!": "SEM CAPAS!",
    "NO ESCAPE": "SEM ESCAPATÓRIA",
    "NUTS ABOUT PRANKS": "LOUCO POR PEGADINHAS",
    "OHANA": "OHANA",
    "OOH, I'M SCARED": "UAU, ESTOU COM MEDO",
    "OUT OF SEASON": "FORA DE TEMPORADA",
    "PAYOFF": "RECOMPENSA",
    "PERFECT TRAP": "ARMADILHA PERFEITA",
    "PIPE UP THE CREW": "INCENTIVE A TRIPULAÇÃO",
    "PIXIE DUST": "PÓ DE FADA",
    "PLAYTIME'S OVER": "A BRINCADEIRA ACABOU",
    "POP!": "POP!",
    "POUNCE": "DAR O BOTE",
    "PULL BACK": "RECUAR",
    "PUNY PIRATE!": "PIRATA MIRRADO!",
    "QUICK-STEP": "PASSO RÁPIDO",
    "RAAAWR!": "RAAAWR!",
    "RAPID FIRE": "FOGO RÁPIDO",
    "RECORD TIME": "TEMPO RECORDE",
    "REGROUP": "REAGRUPAR",
    "REPUTATION": "REPUTAÇÃO",
    "ROCK THE BOAT": "SACUDIR O BARCO",
    "ROYAL COMMAND": "COMANDO REAL",
    "SACREBLEU!": "SACREBLEU!",
    "SALVAGE": "RECUPERAR",
    "SEEKING KNOWLEDGE": "EM BUSCA DE CONHECIMENTO",
    "SENDING BACKUP": "ENVIANDO REFORÇOS",
    "SHADOW POWER": "PODER DAS SOMBRAS",
    "SHADOW'S GRASP": "AGARRE DA SOMBRA",
    "SHIFTING SANDS": "AREIAS MOVEDIÇAS",
    "SHINING BEACON": "FAROL BRILHANTE",
    "SHOWBOATING": "EXIBICIONISMO",
    "SLIPPERY SLOPE": "LADEIRA ESCORREGADIA",
    "SLIPPERY SPELL": "FEITIÇO ESCORREGADIO",
    "SMOOTH THE WAY": "ABRIR CAMINHO",
    "SNOWY SURPRISE": "SURPRESA NEVADA",
    "SO CHEESY": "TÃO BREGA",
    "SO PRETTY": "TÃO BONITA",
    "SOLID GROUND": "TERRENO FIRME",
    "SPOILER ALERT": "ALERTA DE SPOILER",
    "SPYCRAFT": "ESPIONAGEM",
    "STICK TO THE PLAN": "SIGA O PLANO",
    "SUDDEN SPIN": "GIRO REPENTINO",
    "SUIT UP": "EQUIPAR-SE",
    "TEAMWORK": "TRABALHO EM EQUIPE",
    "TRIPLE SHOT": "TIRO TRIPLO",
    "UNDERDOG": "AZARÃO",
    "UNTOUCHABLE": "INTOCÁVEL",
    "WELL-READ": "BEM-INFORMADO",
    "WHISPERED POWER": "PODER SUSSURRADO",
    "WINTER AMBUSH": "EMBOSCADA DE INVERNO",
    "WINTER STOCKPILE": "ESTOQUE DE INVERNO",
    "WONDER BOY": "GAROTO PRODÍGIO",
    "WORTH MINING": "VALE A PENA MINERAR",
    "WRAPPED UP": "EMBRULHADO",
    "YODEL-AY-HEE-HOO!": "YODEL-AY-HEE-HOO!",
}


# The order matters. Rules are intentionally narrow enough to avoid changing card
# names or numbers. They repair the current overlay rather than retranslate it.
REPLACEMENTS: tuple[tuple[str, str, int], ...] = (
    (r"\bfizer missão\b", "buscar Lore", re.IGNORECASE),
    (r"\bfizerem missão\b", "buscarem Lore", re.IGNORECASE),
    (r"\bfaz missão\b", "busca Lore", re.IGNORECASE),
    (r"\bfazem missão\b", "buscam Lore", re.IGNORECASE),
    (r"\bfez missão\b", "buscou Lore", re.IGNORECASE),
    (r"\bfazer missão\b", "buscar Lore", re.IGNORECASE),
    (r"\bem missão\b", "buscando Lore", re.IGNORECASE),
    (r"\bdesenhar (\d+|uma?) cartas?\b", r"comprar \1 carta", re.IGNORECASE),
    (r"\bdesenhe (\d+) cartas?\b", r"compre \1 cartas", re.IGNORECASE),
    (r"\bdesenhe uma carta\b", "compre uma carta", re.IGNORECASE),
    (r"\bdesenhe a carta\b", "compre a carta", re.IGNORECASE),
    (r"\bdesenhar cartas?\b", "comprar cartas", re.IGNORECASE),
    (r"\bdesenhe cartas?\b", "compre cartas", re.IGNORECASE),
    (r"\bdesenhar\b", "comprar", re.IGNORECASE),
    (r"\bdesenha\b", "compra", re.IGNORECASE),
    (r"\bdesenhe\b", "compre", re.IGNORECASE),
    (r"\bdesenhou\b", "comprou", re.IGNORECASE),
    (r"\bdesenhando\b", "comprando", re.IGNORECASE),
    (r"\bum carta\b", "uma carta", re.IGNORECASE),
    (r"\bo carta\b", "a carta", re.IGNORECASE),
    (r"\b([2-9]|[1-9]\d+) carta\b", r"\1 cartas", re.IGNORECASE),
    (r"\bsua próximo\b", "seu próximo", re.IGNORECASE),
    (r"\bseu próxima\b", "sua próxima", re.IGNORECASE),
    (r"\bda seu\b", "do seu", re.IGNORECASE),
    (r"\bdo sua\b", "da sua", re.IGNORECASE),
    (r"\bnesta exertada\b", "neste turno", re.IGNORECASE),
    (r"\bnessa exertada\b", "nesse turno", re.IGNORECASE),
    (r"\bcada exertada\b", "a cada turno", re.IGNORECASE),
    (r"\bpróxima exertada\b", "próximo turno", re.IGNORECASE),
    (r"\bsua próxima exertada\b", "seu próximo turno", re.IGNORECASE),
    (r"\bcarta superior\b", "carta do topo", re.IGNORECASE),
    (r"\bpersonagem oposto\b", "personagem adversário", re.IGNORECASE),
    (r"\bEmbora este personagem\b", "Enquanto este personagem", re.IGNORECASE),
    (r"\b(?:tocar|toca|tocou) (uma|esta|a) canção\b", r"jogar \1 canção", re.IGNORECASE),
    (r"\b([2-9]|[1-9]\d+) danos\b", r"\1 de dano", re.IGNORECASE),
    (r"\bdurante a sua vez\b", "durante seu turno", re.IGNORECASE),
    (r"\bdurante sua vez\b", "durante seu turno", re.IGNORECASE),
    (r"\buma vez durante a sua vez\b", "uma vez durante seu turno", re.IGNORECASE),
    (r"\bno início da sua vez\b", "no início do seu turno", re.IGNORECASE),
    (r"\bno início de sua vez\b", "no início do seu turno", re.IGNORECASE),
    (r"\baté o fim da sua vez\b", "até o fim do seu turno", re.IGNORECASE),
    (r"\baté o final da sua vez\b", "até o fim do seu turno", re.IGNORECASE),
    (r"\bnesta volta\b", "neste turno", re.IGNORECASE),
    (r"\bnessa volta\b", "nesse turno", re.IGNORECASE),
    (r"\bpróxima volta\b", "próximo turno", re.IGNORECASE),
    (r"\bpróxima vez\b", "próximo turno", re.IGNORECASE),
    (r"\bsua próxima vez\b", "seu próximo turno", re.IGNORECASE),
    (r"\ba sua vez\b", "seu turno", re.IGNORECASE),
    (r"\bsua vez\b", "seu turno", re.IGNORECASE),
    (r"\besta vez\b", "neste turno", re.IGNORECASE),
    (r"\bcada volta\b", "a cada turno", re.IGNORECASE),
    (r"\bcada turno\b", "a cada turno", re.IGNORECASE),
    (r"\bprimeira vez\b", "primeiro turno", re.IGNORECASE),
    (r"\bcurva\b", "turno", re.IGNORECASE),
    (r"\bface[- ]?down\b", "com a face para baixo", re.IGNORECASE),
    (r"\bface[- ]?up\b", "com a face para cima", re.IGNORECASE),
    (r"\bpoços? de tinta\b", "tinteiro", re.IGNORECASE),
    (r"\bvirar-los\b", "exertá-los", re.IGNORECASE),
    (r"\bvirá-los\b", "exertá-los", re.IGNORECASE),
    (r"\bvirar este\b", "exertar este", re.IGNORECASE),
    (r"\bvirar esta\b", "exertar esta", re.IGNORECASE),
    (r"\bvirar todas\b", "exertar todas", re.IGNORECASE),
    (r"\bvirar todos\b", "exertar todos", re.IGNORECASE),
    (r"\bvirar\b", "exertar", re.IGNORECASE),
    (r"\bvire\b", "exerte", re.IGNORECASE),
    (r"\bvirado\b", "exertado", re.IGNORECASE),
    (r"\bvirada\b", "exertada", re.IGNORECASE),
    (r"\bvirados\b", "exertados", re.IGNORECASE),
    (r"\bviradas\b", "exertadas", re.IGNORECASE),
    (r"\bdesvirar\b", "desexertar", re.IGNORECASE),
    (r"\bdesvirado\b", "desexertado", re.IGNORECASE),
    (r"\bpronto personagens\b", "personagens preparados", re.IGNORECASE),
    (r"\bpersonagens prontos\b", "personagens preparados", re.IGNORECASE),
    (r"\boponentes\b", "adversários", re.IGNORECASE),
    (r"\boponente\b", "adversário", re.IGNORECASE),
    (r"\bjogadores adversários\b", "adversários", re.IGNORECASE),
    (r"\bjogador adversário\b", "adversário", re.IGNORECASE),
    (r"\bpersonagem oponente\b", "personagem adversário", re.IGNORECASE),
    (r"\bcartões\b", "cartas", re.IGNORECASE),
    (r"\bcartão\b", "carta", re.IGNORECASE),
    (r"\bcarta de caráter\b", "carta de personagem", re.IGNORECASE),
    (r"\bcartas de caráter\b", "cartas de personagem", re.IGNORECASE),
    (r"\bmúsicas\b", "canções", re.IGNORECASE),
    (r"\bmúsica\b", "canção", re.IGNORECASE),
    (r"\btocar esta carta\b", "jogar esta carta", re.IGNORECASE),
    (r"\btocar isso\b", "jogar esta carta", re.IGNORECASE),
    (r"\btocou uma canção\b", "jogou uma canção", re.IGNORECASE),
    (r"\btocou uma música\b", "jogou uma canção", re.IGNORECASE),
    (r"\bde graça\b", "sem pagar o custo", re.IGNORECASE),
    (r"\bgratuitamente\b", "sem pagar o custo", re.IGNORECASE),
    (r"\bem um desafiar\b", "em um desafio", re.IGNORECASE),
    (r"\bde desafia\b", "de desafios", re.IGNORECASE),
    (r"\benquanto desafiante\b", "enquanto desafia", re.IGNORECASE),
    (r"\benquanto desafiando\b", "enquanto desafia", re.IGNORECASE),
    (r"\bdano tratado com este personagem\b", "dano causado a este personagem", re.IGNORECASE),
    (r"\bdanos tratados para este personagem\b", "o dano causado a este personagem", re.IGNORECASE),
    (r"\bdamage tratado para eles\b", "o dano causado a eles", re.IGNORECASE),
    (r"\bdamage tratado a eles\b", "o dano causado a eles", re.IGNORECASE),
    (r"\bdamagem tratada a eles\b", "o dano causado a eles", re.IGNORECASE),
    (r"\bdamage tradeed to them\b", "o dano causado a eles", re.IGNORECASE),
    (r"\bdamage traded to this character\b", "o dano causado a este personagem", re.IGNORECASE),
    (r"\bdamage dealth to this character is reduxed by (\d+)\b",
     r"o dano causado a este personagem é reduzido em \1", re.IGNORECASE),
    (r"\bdeal (\d+) dano(?:s)?\b", r"cause \1 de dano", re.IGNORECASE),
    (r"\bdanifique (\d+) dano(?:s)?\b", r"cause \1 de dano", re.IGNORECASE),
    (r"\bder (\d+) dano(?:s)?\b", r"causar \1 de dano", re.IGNORECASE),
    (r"\blidar com (\d+) dano(?:s)?\b", r"causar \1 de dano", re.IGNORECASE),
    (r"\blidar com a mesma quantidade de danos\b", "cause a mesma quantidade de dano", re.IGNORECASE),
    (r"\bbanir escolheu personagem\b", "bana o personagem escolhido", re.IGNORECASE),
    (r"\bbanir escolheu o personagem\b", "bana o personagem escolhido", re.IGNORECASE),
    (r"\bo caracter escolhido pelo banir\b", "bana o personagem escolhido", re.IGNORECASE),
    (r"\bescolher o personagem banir\b", "banir o personagem escolhido", re.IGNORECASE),
    (r"\bbanir personagem escolhido\b", "banir o personagem escolhido", re.IGNORECASE),
    (r"\bcoloque personagem escolhido\b", "coloque o personagem escolhido", re.IGNORECASE),
    (r"\bdevolver personagem escolhido\b", "devolva o personagem escolhido", re.IGNORECASE),
    (r"\bescolher o personagem virar\b", "exertar o personagem escolhido", re.IGNORECASE),
    (r"\bescolheu personagem\b", "personagem escolhido", re.IGNORECASE),
    (r"\bescolheu o personagem\b", "o personagem escolhido", re.IGNORECASE),
    (r"\bdesafiar-los\b", "desafiá-los", re.IGNORECASE),
    (r"\bescolher eles\b", "escolhê-los", re.IGNORECASE),
    (r"\bbanir eles\b", "bani-los", re.IGNORECASE),
    (r"\bcolocá-los de volta\b", "colocá-las de volta", re.IGNORECASE),
    (r"(^|[.!?—]\s+)ganhar\b", r"\1ganhe", re.IGNORECASE),
    (r"(^|[.!?—]\s+)causar\b", r"\1cause", re.IGNORECASE),
    (r"(^|[.!?—]\s+)exertar\b", r"\1exerte", re.IGNORECASE),
    (r"(^|[.!?—]\s+)banir\b", r"\1bana", re.IGNORECASE),
    (r"(^|[.!?—]\s+)devolver\b", r"\1devolva", re.IGNORECASE),
    (r"(^|[.!?—]\s+)revelar\b", r"\1revele", re.IGNORECASE),
    (r"(^|[.!?—]\s+)colocar\b", r"\1coloque", re.IGNORECASE),
    (r"(^|[.!?—]\s+)remover\b", r"\1remova", re.IGNORECASE),
    # Final-pass repairs for defects created after earlier terminology rules.
    (r"\bum carta\b", "uma carta", re.IGNORECASE),
    (r"\bo carta\b", "a carta", re.IGNORECASE),
    (r"\bsua próximo\b", "seu próximo", re.IGNORECASE),
    (r"\bda sua próximo\b", "do seu próximo", re.IGNORECASE),
    (r"\bseu próxima\b", "sua próxima", re.IGNORECASE),
    (r"\bda seu\b", "do seu", re.IGNORECASE),
    (r"\bdo sua\b", "da sua", re.IGNORECASE),
    (r"\bnesta exertada\b", "neste turno", re.IGNORECASE),
    (r"\bnessa exertada\b", "nesse turno", re.IGNORECASE),
    (r"\bcada exertada\b", "a cada turno", re.IGNORECASE),
    (r"\bpróxima exertada\b", "próximo turno", re.IGNORECASE),
    (r"\bsua próxima exertada\b", "seu próximo turno", re.IGNORECASE),
    (r"\b(?:tocar|toca|tocou) (uma|esta|a) canção\b", r"jogar \1 canção", re.IGNORECASE),
    (r"\btocar (um|outro|este) personagem\b", r"jogar \1 personagem", re.IGNORECASE),
    (r"\btocar (um|outro|este) item\b", r"jogar \1 item", re.IGNORECASE),
    (r"\bno final da seu turno\b", "no final do seu turno", re.IGNORECASE),
    (r"\bno final da sua turno\b", "no final do seu turno", re.IGNORECASE),
    (r"\bpara o resto desta (?:vez|volta)\b", "pelo restante deste turno", re.IGNORECASE),
    (r"\ba vez que (?:ele|ela) (?:é|foi) jogad[oa]\b", "no turno em que é jogado", re.IGNORECASE),
    (r"\ba vez que eles são jogados\b", "no turno em que são jogados", re.IGNORECASE),
    (r"\bexertar escolher personagem adversário\b", "exertar o personagem adversário escolhido", re.IGNORECASE),
    (r"\bbanir escolher (?:o )?personagem\b", "banir o personagem escolhido", re.IGNORECASE),
    (r"\bbanir item escolhido\b", "banir o item escolhido", re.IGNORECASE),
    (r"\bcaracter\b", "personagem", re.IGNORECASE),
)


RISK_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("english_residue", STRONG_ENGLISH_RE),
    ("quest_literal", re.compile(r"\b(?:fazer|faz|fizer|fez) missão\b", re.I)),
    ("draw_literal", re.compile(r"\bdesenh(?:ar|e|a|ou|ando)\b", re.I)),
    ("turn_literal", re.compile(r"\b(?:curva|esta vez|próxima vez)\b", re.I)),
    ("chosen_word_order", re.compile(r"\b(?:banir escolheu|escolher o personagem banir)\b", re.I)),
    ("garbled_symbols", re.compile(r"(?:,\s*){3,}|(?:\.\s*){5,}")),
    ("grammar_fragment", re.compile(
        r"\b(?:pronto personagens?|personagem virado escolhido|redu.xed|tradeed|"
        r"dealth|damagem|caracter escolhido pelo)\b", re.I)),
)


def json_load(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def json_dump(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        json.dump(value, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def game_tokens(text: str) -> collections.Counter[str]:
    return collections.Counter(GAME_TOKEN_RE.findall(text or ""))


def normalize_spaces(text: str) -> str:
    text = unicodedata.normalize("NFC", text or "")
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" +([,.;:!?])", r"\1", text)
    text = re.sub(r"([,.;:!?])(?=[^\s})\]])", r"\1 ", text)
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r"\s+\)", ")", text)
    return text.strip()


def dynamic_exact_translation(english: str) -> str | None:
    """Translate complete recurring keyword texts with variable numbers/names."""
    m = re.fullmatch(
        r"Resist \+(\d+) \(Damage dealt to this character is reduced by \1\.\)",
        english.strip(),
    )
    if m:
        n = m.group(1)
        return f"Resistir +{n} (O dano causado a este personagem é reduzido em {n}.)"

    m = re.fullmatch(
        r"Challenger \+(\d+) \(While challenging, this character gets \+\1 \{s\}\.\)",
        english.strip(),
    )
    if m:
        n = m.group(1)
        return f"Desafiante +{n} (Enquanto desafia, este personagem recebe +{n} {{s}}.)"

    m = re.fullmatch(
        r"Singer (\d+) \(This character counts as cost \1 to sing songs\.\)",
        english.strip(),
    )
    if m:
        n = m.group(1)
        return f"Cantor {n} (Este personagem conta como custo {n} para cantar canções.)"

    m = re.fullmatch(
        r"Boost (\d+) \{i\} \(Once during your turn, you may pay \1 \{i\} to put the top card of your deck facedown under this character\.\)",
        english.strip(),
    )
    if m:
        n = m.group(1)
        return (
            f"Impulso {n} {{i}} (Uma vez durante seu turno, você pode pagar {n} "
            "{i} para colocar a carta do topo do seu baralho com a face para baixo "
            "sob este personagem.)"
        )

    m = re.fullmatch(
        r"Shift (\d+)( \{i\})? \(You may pay \1( \{i\})? to play this on top of one of your characters named (.+?)\.\)",
        english.strip(),
    )
    if m:
        n, header_ink, payment_ink, name = m.groups()
        header_ink = header_ink or ""
        payment_ink = payment_ink or ""
        return (
            f"Transformar {n}{header_ink} (Você pode pagar {n}{payment_ink} para jogar esta carta "
            f"sobre um de seus personagens chamado {name}.)"
        )

    return None


def apply_repairs(
    english: str,
    portuguese: str,
    ability_id: str | None = None,
    ability_name: str | None = None,
) -> tuple[str, list[str]]:
    if ability_id and ability_id in ABILITY_OVERRIDES:
        return ABILITY_OVERRIDES[ability_id], ["ability_override"]
    exact = EXACT_TRANSLATIONS.get(english.strip()) or dynamic_exact_translation(english)
    if exact is not None:
        return exact, ["translation_memory"]

    text = normalize_spaces(portuguese)
    applied: list[str] = []
    for index, (pattern, replacement, flags) in enumerate(REPLACEMENTS):
        changed, count = re.subn(pattern, replacement, text, flags=flags)
        if count:
            text = changed
            applied.append(f"rule_{index + 1}")

    if ability_name and ability_name in ABILITY_NAME_TRANSLATIONS:
        translated_name = ABILITY_NAME_TRANSLATIONS[ability_name]
        changed, count = re.subn(
            rf"^{re.escape(ability_name)}",
            translated_name,
            text,
            count=1,
            flags=re.IGNORECASE,
        )
        if count:
            text = changed
            applied.append("ability_name_memory")

    # Canonical reminder clauses inside larger abilities.
    reminder_repairs = (
        (
            r"\(Este personagem pode desafiar (?:a vez|no turno) que (?:eles são|é) jogado\.\)",
            "(Este personagem pode desafiar no turno em que é jogado.)",
        ),
        (
            r"\(Apenas os personagens com Evasivo podem desafiar este personagem\.\)",
            "(Somente personagens com Evasivo podem desafiar este personagem.)",
        ),
        (
            r"\(Os adversários não podem escolher este personagem exceto para desafiar\.\)",
            "(Os adversários não podem escolher este personagem, exceto para desafiá-lo.)",
        ),
        (
            r"\(Este personagem não pode buscar Lore e deve desafiar a cada turno se for capaz\.\)",
            "(Este personagem não pode buscar Lore e deve desafiar a cada turno, se possível.)",
        ),
    )
    for index, (pattern, replacement) in enumerate(reminder_repairs):
        changed, count = re.subn(pattern, replacement, text, flags=re.I)
        if count:
            text = changed
            applied.append(f"reminder_{index + 1}")

    text = normalize_spaces(text)
    return text, applied


def issue_codes(english: str, portuguese: str) -> list[str]:
    issues: list[str] = []
    if not portuguese.strip():
        issues.append("empty")
    if game_tokens(english) != game_tokens(portuguese):
        issues.append("game_token_mismatch")
    if (
        english.count("(") == english.count(")")
        and portuguese.count("(") != portuguese.count(")")
    ):
        issues.append("unbalanced_parentheses")
    for code, pattern in RISK_PATTERNS:
        if pattern.search(portuguese):
            issues.append(code)
    en_len = max(len(english.strip()), 1)
    ratio = len(portuguese.strip()) / en_len
    if ratio < 0.40:
        issues.append("suspiciously_short")
    elif ratio > 2.25:
        issues.append("suspiciously_long")
    return sorted(set(issues))


def validate_shape(english: dict[str, Any], overlay: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    cards_en = english.get("cards")
    cards_pt = overlay.get("cards")
    if not isinstance(cards_en, list):
        return ["English cards must be a list"]
    if not isinstance(cards_pt, dict):
        return ["Portuguese overlay cards must be an object keyed by card_id"]

    en_by_id = {card.get("card_id"): card for card in cards_en}
    if set(en_by_id) != set(cards_pt):
        missing = sorted(set(en_by_id) - set(cards_pt))
        extra = sorted(set(cards_pt) - set(en_by_id))
        errors.append(f"card_id mismatch: missing={missing[:5]} extra={extra[:5]}")

    for card_id in sorted(set(en_by_id) & set(cards_pt)):
        en_card = en_by_id[card_id]
        pt_card = cards_pt[card_id]
        en_abilities = en_card.get("abilities") or []
        pt_abilities = pt_card.get("abilities") or []
        if pt_card.get("ability_count") != len(en_abilities):
            errors.append(
                f"{card_id}: ability_count={pt_card.get('ability_count')} "
                f"but English has {len(en_abilities)}"
            )
        en_ids = [a.get("ability_id") for a in en_abilities]
        pt_ids = [a.get("ability_id") for a in pt_abilities]
        if en_ids != pt_ids:
            errors.append(f"{card_id}: ability_id/order mismatch")
        if not isinstance(pt_card.get("source_fingerprint"), str):
            errors.append(f"{card_id}: missing source_fingerprint")
    return errors


def iter_aligned(
    english: dict[str, Any], overlay: dict[str, Any]
) -> Iterable[tuple[str, dict[str, Any], dict[str, Any]]]:
    en_by_id = {card["card_id"]: card for card in english["cards"]}
    for card_id, pt_card in overlay["cards"].items():
        en_card = en_by_id[card_id]
        en_abilities = {a["ability_id"]: a for a in en_card.get("abilities") or []}
        for pt_ability in pt_card.get("abilities") or []:
            yield card_id, en_abilities[pt_ability["ability_id"]], pt_ability


def refine(
    english: dict[str, Any], overlay: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    structural_errors = validate_shape(english, overlay)
    if structural_errors:
        raise ValueError("Input contract failed:\n- " + "\n- ".join(structural_errors[:30]))

    result = copy.deepcopy(overlay)
    before_by_id = {
        pt_a["ability_id"]: pt_a["text"]
        for _, _, pt_a in iter_aligned(english, overlay)
    }
    en_by_id = {
        en_a["ability_id"]: en_a["text"]
        for _, en_a, _ in iter_aligned(english, overlay)
    }

    rule_counter: collections.Counter[str] = collections.Counter()
    changed_ids: set[str] = set()
    for _, en_ability, pt_ability in iter_aligned(english, result):
        refined, applied = apply_repairs(
            en_ability["text"],
            pt_ability["text"],
            pt_ability["ability_id"],
            en_ability.get("name"),
        )
        if refined != pt_ability["text"]:
            changed_ids.add(pt_ability["ability_id"])
            pt_ability["text"] = refined
        rule_counter.update(applied)

    # Exact English duplicates should have one deterministic Portuguese rendering.
    grouped: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
    for _, en_ability, pt_ability in iter_aligned(english, result):
        grouped[en_ability["text"]].append(
            (pt_ability["ability_id"], pt_ability["text"])
        )

    unified = 0
    pt_lookup = {
        pt_a["ability_id"]: pt_a
        for _, _, pt_a in iter_aligned(english, result)
    }
    for en_text, candidates in grouped.items():
        if len(candidates) < 2:
            continue
        counts = collections.Counter(text for _, text in candidates)
        ranked = sorted(
            counts,
            key=lambda text: (
                len(issue_codes(en_text, text)),
                -counts[text],
                abs(len(text) - len(en_text)),
                text,
            ),
        )
        best = ranked[0]
        for ability_id, current in candidates:
            if current != best:
                pt_lookup[ability_id]["text"] = best
                changed_ids.add(ability_id)
                unified += 1

    result["generated_at"] = (
        dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    )

    findings: list[dict[str, Any]] = []
    issue_counter: collections.Counter[str] = collections.Counter()
    for card_id, en_ability, pt_ability in iter_aligned(english, result):
        issues = issue_codes(en_ability["text"], pt_ability["text"])
        issue_counter.update(issues)
        if issues:
            findings.append(
                {
                    "card_id": card_id,
                    "ability_id": pt_ability["ability_id"],
                    "issues": issues,
                    "english_sha256": text_sha256(en_ability["text"]),
                    "portuguese_sha256": text_sha256(pt_ability["text"]),
                    "english_length": len(en_ability["text"]),
                    "portuguese_length": len(pt_ability["text"]),
                }
            )

    after_by_id = {
        pt_a["ability_id"]: pt_a["text"]
        for _, _, pt_a in iter_aligned(english, result)
    }
    unchanged = sum(
        before_by_id[ability_id] == after_by_id[ability_id]
        for ability_id in before_by_id
    )
    report = {
        "report_version": 1,
        "generated_at": result["generated_at"],
        "language": "pt-BR",
        "policy": {
            "card_names": "preserve English",
            "gameplay_text": "natural Brazilian Portuguese",
            "mechanics": "never invent; preserve aligned source",
            "unresolved": "editorial review required",
        },
        "counts": {
            "cards": len(result["cards"]),
            "abilities": len(before_by_id),
            "abilities_changed": len(changed_ids),
            "abilities_unchanged": unchanged,
            "duplicate_variants_unified": unified,
            "abilities_requiring_review": len(findings),
            "abilities_without_flagged_issues": len(before_by_id) - len(findings),
        },
        "applied_rule_counts": dict(sorted(rule_counter.items())),
        "remaining_issue_counts": dict(sorted(issue_counter.items())),
        "findings": findings,
    }
    return result, report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--english", required=True, type=Path)
    parser.add_argument("--portuguese", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero if any editorial-review finding remains.",
    )
    args = parser.parse_args()

    english = json_load(args.english)
    overlay = json_load(args.portuguese)
    result, report = refine(english, overlay)
    json_dump(args.output, result)
    json_dump(args.report, report)

    counts = report["counts"]
    print(
        "PT-BR refinement complete: "
        f"{counts['cards']} cards, {counts['abilities']} abilities, "
        f"{counts['abilities_changed']} changed, "
        f"{counts['abilities_requiring_review']} require review."
    )
    if args.strict and counts["abilities_requiring_review"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
