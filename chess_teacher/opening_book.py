"""Opening lines for the Openings trainer.

Each opening is played from one side ("color"). Its lines are written as SAN moves
from the start position, with an optional {idea} after a move explaining it. Lines
that share a beginning form a tree: where the opponent has several book replies the
trainer picks one (weighted), while the trainee always has exactly one book move.
After a line ends, Stockfish carries the opening on to `length` trainee moves.
"""
from __future__ import annotations

OPENINGS = [
    # ------------------------------------------------------------------ White
    {
        "id": "italian",
        "name": "Italian Game",
        "color": "white",
        "summary": "Quick development, the bishop aims at Black's weak f7 square, then a slow build-up with c3 and d3.",
        "length": 10,
        "lines": [
            {
                "name": "Giuoco Pianissimo",
                "weight": 4,
                "moves": """
                    e4 {Take the center and open lines for your bishop and queen.}
                    e5
                    Nf3 {Develop a knight and attack the e5 pawn.}
                    Nc6 {Black defends e5.}
                    Bc4 {The Italian bishop: it eyes f7, the weakest square near Black's king.}
                    Bc5
                    c3 {Prepare d4 to build a big center, and take d4 away from Black's knight.}
                    Nf6 {Black attacks your e4 pawn.}
                    d3 {Calmly protect e4. The slow 'Pianissimo' set-up: solid and flexible.}
                    d6
                    O-O {Castle: king safe, rook heads to the center.}
                    O-O
                    Re1 {The rook backs up e4 and gets ready for a later d4 or Nf1-g3.}
                    a6 {Black makes a retreat square for the bishop.}
                    a4 {Gain space on the queenside so ...b5 is harder for Black.}
                    Ba7
                    h3 {Stop ...Bg4 or ...Ng4 before bringing the knight around.}
                    h6
                    Nbd2 {The queen's knight heads for f1 and g3 to support the kingside.}
                """,
            },
            {
                "name": "Two Knights Defense, 4.d3",
                "weight": 3,
                "moves": """
                    e4 e5 Nf3 Nc6 Bc4
                    Nf6 {The Two Knights: Black hits e4 at once instead of developing the bishop.}
                    d3 {Protect e4 quietly. This avoids the sharp lines after 4.Ng5.}
                    Be7
                    O-O {Castle first, then build with c3 and Re1.}
                    O-O
                    Re1 {Support e4 and prepare c3 and Nbd2-f1.}
                    d6
                    c3 {Make room for the bishop to retreat to c2 and prepare d4.}
                    Bg4 {Black pins your knight to the queen.}
                    h3 {Ask the bishop a question: take or retreat.}
                    Bh5
                    Nbd2 {Develop the last minor piece; it can reroute to f1 and g3.}
                """,
            },
        ],
    },
    {
        "id": "ruy-lopez",
        "name": "Ruy Lopez",
        "color": "white",
        "summary": "The bishop pressures the knight that defends e5. A rich, classical opening where White keeps a lasting initiative.",
        "length": 10,
        "lines": [
            {
                "name": "Closed Ruy Lopez",
                "weight": 4,
                "moves": """
                    e4 {Take the center.}
                    e5
                    Nf3 {Develop and attack e5.}
                    Nc6
                    Bb5 {The Ruy Lopez: pressure the knight that defends e5.}
                    a6 {The Morphy Defense: Black asks the bishop what it wants.}
                    Ba4 {Keep the pin-like pressure; Bxc6 can come later.}
                    Nf6
                    O-O {Castle. e4 looks loose, but taking it opens the e-file against Black's king.}
                    Be7
                    Re1 {Protect e4 so Bxc6 and Nxe5 becomes a real threat.}
                    b5 {Black gets rid of the pin.}
                    Bb3 {The bishop moves to its best diagonal, aiming at f7.}
                    d6
                    c3 {Make a retreat square for the bishop and prepare d4.}
                    O-O
                    h3 {Stop ...Bg4 so d4 can follow without your knight getting pinned.}
                    Na5 {Black chases the strong bishop.}
                    Bc2 {Tuck the bishop on c2, still aimed at the kingside.}
                    c5
                    d4 {Finally strike in the center.}
                """,
            },
            {
                "name": "Berlin Defense",
                "weight": 2,
                "moves": """
                    e4 e5 Nf3 Nc6 Bb5
                    Nf6 {The Berlin: Black counterattacks e4.}
                    O-O {Castle. If Black takes on e4, Re1 wins it back.}
                    Nxe4
                    Re1 {Pin the knight against Black's king along the e-file.}
                    Nd6 {The knight escapes and attacks your bishop.}
                    Nxe5 {Win back the pawn.}
                    Be7
                    Bf1 {Keep the bishop; the rook and knight are strong on the e-file.}
                    Nxe5
                    Rxe5 {Recapture with the rook, keeping it active.}
                    O-O
                    d4 {Take the center and open the way for your queen's bishop.}
                    Bf6
                    Re1 {Retreat the rook to safety; your development is easy.}
                """,
            },
        ],
    },
    {
        "id": "scotch",
        "name": "Scotch Game",
        "color": "white",
        "summary": "Open the center at once with d4. Direct and easy to understand: free development and a strong knight on d4.",
        "length": 9,
        "lines": [
            {
                "name": "Scotch, 4...Nf6",
                "weight": 3,
                "moves": """
                    e4 {Take the center.}
                    e5
                    Nf3 {Develop and attack e5.}
                    Nc6
                    d4 {The Scotch: open the center straight away.}
                    exd4
                    Nxd4 {Take back with a centralized knight.}
                    Nf6 {Black develops and hits e4.}
                    Nxc6 {Trade knights to damage Black's pawns.}
                    bxc6
                    e5 {Gain space and kick the knight away from f6.}
                    Qe7 {Black pins your e-pawn to your king.}
                    Qe2 {Unpin by defending the pawn with the queen.}
                    Nd5
                    c4 {Chase the knight from the center.}
                    Ba6 {Black pins your c-pawn to the queen.}
                    b3 {Protect c4 so you can finally develop the kingside.}
                """,
            },
            {
                "name": "Scotch, 4...Bc5",
                "weight": 2,
                "moves": """
                    e4 e5 Nf3 Nc6 d4 exd4 Nxd4
                    Bc5 {Black attacks your knight on d4.}
                    Nxc6 {Trade before the knight gets into trouble.}
                    Qf6 {Black threatens mate on f2 and attacks c6 at the same time.}
                    Qd2 {Stop the mate threat on f2 and keep the extra knight for a moment.}
                    dxc6
                    Nc3 {Develop; Black's queenside pawns are doubled.}
                    Be6
                    Na4 {Go after the strong bishop on c5.}
                    Rd8
                    Bd3 {Develop and defend; castling comes next.}
                    Bd4
                    O-O {King to safety.}
                """,
            },
        ],
    },
    {
        "id": "london",
        "name": "London System",
        "color": "white",
        "summary": "A solid set-up: d4, Bf4, e3, c3, Nf3, Nd2, Bd3. The same plan against almost anything Black plays.",
        "length": 10,
        "lines": [
            {
                "name": "London vs 1...d5",
                "weight": 3,
                "moves": """
                    d4 {Take the center with the queen's pawn.}
                    d5
                    Bf4 {The London bishop: develop it before e3 shuts it in.}
                    Nf6
                    e3 {Support d4 and open the light-squared bishop.}
                    c5 {Black challenges your center.}
                    c3 {Hold d4 firmly with a pawn triangle.}
                    Nc6
                    Nd2 {This knight supports e4 later; the other goes to f3.}
                    e6
                    Ngf3 {Develop and guard d4 and e5.}
                    Bd6 {Black offers to trade your good bishop.}
                    Bg3 {Keep the bishop: if Black takes, your h-pawn recaptures and opens the h-file.}
                    O-O
                    Bd3 {Aim at Black's kingside.}
                    b6
                    O-O {Castle and get ready for Ne5 or e4.}
                    Bb7
                    Qe2 {Support a future e4 break.}
                """,
            },
            {
                "name": "London vs King's Indian set-up",
                "weight": 2,
                "moves": """
                    d4
                    Nf6
                    Bf4 {Same plan: bishop out first.}
                    g6 {Black fianchettoes the bishop.}
                    e3 {Solid support for d4.}
                    Bg7
                    Nf3 {Develop and control e5.}
                    O-O
                    Be2 {A modest square, out of reach of ...e5 tricks.}
                    d6
                    h3 {Make a retreat square on h2 for your bishop.}
                    c5
                    c3 {Keep d4 strong.}
                    Nc6
                    O-O {King to safety; your set-up is complete.}
                """,
            },
        ],
    },
    {
        "id": "queens-gambit",
        "name": "Queen's Gambit",
        "color": "white",
        "summary": "Offer the c-pawn to pull Black's d-pawn away from the center. Classical, positional and rich in plans.",
        "length": 10,
        "lines": [
            {
                "name": "Queen's Gambit Declined",
                "weight": 4,
                "moves": """
                    d4 {Take the center.}
                    d5
                    c4 {The Queen's Gambit: attack d5 with a flank pawn.}
                    e6 {Declined: Black keeps a pawn on d5.}
                    Nc3 {Pile up on d5.}
                    Nf6
                    Bg5 {Pin the knight that defends d5.}
                    Be7
                    e3 {Solid: open your light-squared bishop.}
                    O-O
                    Nf3 {Develop and control e5.}
                    h6 {Black asks the bishop to decide.}
                    Bh4 {Keep the pin.}
                    b6 {The Tartakower: Black prepares ...Bb7.}
                    Be2 {Develop and get ready to castle.}
                    Bb7
                    Bxf6 {Give up the bishop to remove a defender of d5.}
                    Bxf6
                    cxd5 {Release the tension: Black must recapture with a pawn.}
                    exd5
                    O-O {Castle; the plan is pressure on Black's queenside pawns.}
                """,
            },
            {
                "name": "Queen's Gambit Accepted",
                "weight": 2,
                "moves": """
                    d4 d5 c4
                    dxc4 {Accepted: Black takes the pawn, but can't keep it easily.}
                    Nf3 {Develop and stop ...e5.}
                    Nf6
                    e3 {Open the bishop so it can win back c4.}
                    e6
                    Bxc4 {Pawn regained, and your bishop is active.}
                    c5 {Black hits your center.}
                    O-O {Castle first.}
                    a6
                    a4 {Stop ...b5 from gaining space with tempo on your bishop.}
                    Nc6
                    Qe2 {Clear d1 for the rook.}
                    cxd4
                    Rd1 {Put the rook opposite Black's queen on the d-file.}
                    Be7
                    exd4 {Take back with an isolated but active d-pawn.}
                    O-O
                    Nc3 {Develop the last minor piece.}
                """,
            },
            {
                "name": "Slav Defense",
                "weight": 2,
                "moves": """
                    d4 d5 c4
                    c6 {The Slav: Black defends d5 with a pawn and keeps the bishop free.}
                    Nf3 {Develop.}
                    Nf6
                    Nc3 {Add pressure on d5.}
                    dxc4 {Black takes the pawn and hopes to hold it with ...b5.}
                    a4 {Stop ...b5 so the pawn can't be kept.}
                    Bf5
                    e3 {Open the bishop to win back c4.}
                    e6
                    Bxc4 {Pawn back.}
                    Bb4
                    O-O {Castle.}
                    O-O
                    Qe2 {Support the e4 push.}
                    Nbd7
                    e4 {Take the center with gain of time on the bishop.}
                """,
            },
        ],
    },
    {
        "id": "vienna",
        "name": "Vienna Game",
        "color": "white",
        "summary": "Develop the queen's knight first to keep f4 available. Aggressive ideas with an early f-pawn push.",
        "length": 9,
        "lines": [
            {
                "name": "Vienna Gambit",
                "weight": 3,
                "moves": """
                    e4 {Take the center.}
                    e5
                    Nc3 {The Vienna: knight out, keeping the f-pawn free to advance.}
                    Nf6
                    f4 {The Vienna Gambit: attack e5 and open the f-file.}
                    d5 {The best answer: Black strikes back in the center.}
                    fxe5 {Take the pawn and drive the knight away.}
                    Nxe4
                    Nf3 {Develop and protect e5.}
                """,
            },
            {
                "name": "Vienna with Bc4",
                "weight": 2,
                "moves": """
                    e4 e5 Nc3
                    Nc6
                    Bc4 {Aim the bishop at f7.}
                    Nf6
                    d3 {Protect e4 solidly, then develop with Nf3 or f4.}
                """,
            },
        ],
    },
    # ------------------------------------------------------------------ Black
    {
        "id": "sicilian",
        "name": "Sicilian Defense",
        "color": "black",
        "summary": "Answer 1.e4 with 1...c5: fight for d4 from the side and play for a win with an unbalanced position.",
        "length": 10,
        "lines": [
            {
                "name": "Najdorf",
                "weight": 4,
                "moves": """
                    e4
                    c5 {The Sicilian: fight for d4 with a flank pawn.}
                    Nf3
                    d6 {Control e5 and open the bishop.}
                    d4
                    cxd4 {Trade a wing pawn for White's center pawn.}
                    Nxd4
                    Nf6 {Develop with an attack on e4.}
                    Nc3
                    a6 {The Najdorf: control b5 and prepare ...e5 or ...b5.}
                    Be3
                    e5 {Kick the knight from the center and claim space.}
                    Nb3
                    Be6 {Develop and control d5.}
                    f3
                    Be7
                    Qd2
                    O-O {King to safety before the middlegame starts.}
                    O-O-O
                    Nbd7 {Develop; ...b5 and a queenside attack come next.}
                """,
            },
            {
                "name": "Najdorf, 6.Be2",
                "weight": 2,
                "moves": """
                    e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6
                    Be2
                    e5 {Same idea: kick the knight and grab space.}
                    Nb3
                    Be7 {Develop and get ready to castle.}
                    O-O
                    O-O
                    Be3
                    Be6 {Fight for the d5 square.}
                """,
            },
            {
                "name": "Alapin (2.c3)",
                "weight": 2,
                "moves": """
                    e4 c5
                    c3 {White wants to build a full center with d4.}
                    Nf6 {Hit e4 at once.}
                    e5
                    Nd5 {The knight sits well in the center.}
                    d4
                    cxd4 {Trade off White's center.}
                    Nf3
                    Nc6 {Develop and pressure e5 and d4.}
                """,
            },
            {
                "name": "Closed Sicilian (2.Nc3)",
                "weight": 2,
                "moves": """
                    e4 c5
                    Nc3
                    Nc6 {Develop and control d4.}
                    g3
                    g6 {Mirror White with a fianchetto.}
                    Bg2
                    Bg7 {The bishop fights for d4.}
                    d3
                    d6 {Solid: keep e5 covered.}
                    f4
                    e6 {Prepare ...Nge7 so the knight doesn't block the f-pawn.}
                    Nf3
                    Nge7
                    O-O
                    O-O {King to safety; ...Rb8 and ...b5 are typical plans.}
                """,
            },
        ],
    },
    {
        "id": "french",
        "name": "French Defense",
        "color": "black",
        "summary": "1...e6 and 2...d5: a solid pawn chain. Black accepts a cramped position and strikes back at White's center with ...c5 and ...f6.",
        "length": 10,
        "lines": [
            {
                "name": "Classical (3.Nc3 Nf6 4.e5)",
                "weight": 3,
                "moves": """
                    e4
                    e6 {Prepare ...d5 with pawn support.}
                    d4
                    d5 {Challenge e4 right away.}
                    Nc3
                    Nf6 {Develop and add pressure on e4.}
                    e5
                    Nfd7 {Retreat and get ready for ...c5.}
                    f4
                    c5 {Hit the base of White's pawn chain.}
                    Nf3
                    Nc6 {More pressure on d4.}
                    Be3
                    cxd4
                    Nxd4
                    Bc5 {Pin-like pressure on d4 through the knight.}
                    Qd2
                    O-O {King to safety; ...a6 and ...b5 follow.}
                """,
            },
            {
                "name": "Advance (3.e5)",
                "weight": 3,
                "moves": """
                    e4 e6 d4 d5
                    e5
                    c5 {Attack the pawn chain at its base, d4.}
                    c3
                    Nc6 {Pile up on d4.}
                    Nf3
                    Qb6 {More pressure on d4 and on b2.}
                    a3
                    c4 {Lock the queenside and stop b4 ideas.}
                """,
            },
            {
                "name": "Exchange (3.exd5)",
                "weight": 2,
                "moves": """
                    e4 e6 d4 d5
                    exd5
                    exd5 {Symmetrical; your light-squared bishop is now free.}
                    Bd3
                    Bd6 {Mirror White's development.}
                    Nf3
                    Nf6
                    O-O
                    O-O
                    Bg5
                    Bg4 {Pin White's knight in return.}
                """,
            },
            {
                "name": "Tarrasch (3.Nd2)",
                "weight": 2,
                "moves": """
                    e4 e6 d4 d5
                    Nd2
                    Nf6 {Hit e4.}
                    e5
                    Nfd7
                    Bd3
                    c5 {Strike at d4.}
                    c3
                    Nc6
                    Ne2
                    cxd4
                    cxd4
                    f6 {Now attack the head of the chain, e5.}
                """,
            },
        ],
    },
    {
        "id": "caro-kann",
        "name": "Caro-Kann Defense",
        "color": "black",
        "summary": "1...c6 and 2...d5: rock-solid. Unlike the French, the light-squared bishop gets out before ...e6.",
        "length": 10,
        "lines": [
            {
                "name": "Classical (4...Bf5)",
                "weight": 4,
                "moves": """
                    e4
                    c6 {Prepare ...d5 with pawn support.}
                    d4
                    d5 {Challenge e4.}
                    Nc3
                    dxe4 {Trade in the center.}
                    Nxe4
                    Bf5 {Develop the bishop with tempo on the knight.}
                    Ng3
                    Bg6 {Keep the bishop on its good diagonal.}
                    h4
                    h6 {Make a safe square so h5 doesn't trap the bishop.}
                    Nf3
                    Nd7 {Stop Ne5, which would hit your bishop.}
                    h5
                    Bh7
                    Bd3
                    Bxd3 {Trade off White's best attacking piece.}
                    Qxd3
                    e6 {Solid; ...Ngf6, ...Be7 or ...Qc7 and castling follow.}
                """,
            },
            {
                "name": "Advance (3.e5)",
                "weight": 3,
                "moves": """
                    e4 c6 d4 d5
                    e5
                    Bf5 {Develop the bishop outside the pawn chain before ...e6.}
                    Nf3
                    e6
                    Be2
                    c5 {Strike at d4.}
                    Be3
                    cxd4 {Trade before White can support d4.}
                """,
            },
            {
                "name": "Exchange (3.exd5)",
                "weight": 2,
                "moves": """
                    e4 c6 d4 d5
                    exd5
                    cxd5 {Take back toward the center.}
                    Bd3
                    Nc6 {Develop and pressure d4.}
                    c3
                    Nf6
                    Bf4
                    Bg4 {Develop actively before ...e6.}
                    Qb3
                    Qd7 {Defend b7 and keep the bishop protected.}
                    Nd2
                    e6
                    Ngf3
                    Bd6 {Offer to trade White's active bishop.}
                """,
            },
            {
                "name": "Two Knights (2.Nc3)",
                "weight": 1,
                "moves": """
                    e4 c6
                    Nc3
                    d5 {Same idea: challenge e4.}
                    Nf3
                    Bg4 {Pin the knight.}
                    h3
                    Bxf3 {Give up the bishop to damage White's development.}
                    Qxf3
                    e6
                    d4
                    Nf6
                """,
            },
        ],
    },
    {
        "id": "open-game-black",
        "name": "1...e5 vs the Italian",
        "color": "black",
        "summary": "Meet 1.e4 with 1...e5 and develop classically: knights before bishops, castle early, hold the center.",
        "length": 10,
        "lines": [
            {
                "name": "Giuoco Pianissimo",
                "weight": 4,
                "moves": """
                    e4
                    e5 {Claim your share of the center.}
                    Nf3
                    Nc6 {Defend e5 and develop.}
                    Bc4
                    Bc5 {Mirror White: the bishop eyes f2.}
                    c3
                    Nf6 {Develop with an attack on e4.}
                    d3
                    d6 {Support e5 and open the queen's bishop.}
                    O-O
                    O-O {King to safety.}
                    Re1
                    a6 {Make a retreat square for the bishop so it isn't hit by d4 or b4.}
                    a4
                    Ba7 {Keep the bishop on the a7-g1 diagonal.}
                    h3
                    h6 {Stop Bg5 pins.}
                    Nbd2
                    Re8 {Support e5 and get ready for ...Be6.}
                """,
            },
            {
                "name": "Italian, 4.O-O",
                "weight": 2,
                "moves": """
                    e4 e5 Nf3 Nc6 Bc4 Bc5
                    O-O
                    Nf6 {Develop and hit e4.}
                    d3
                    O-O {Castle too.}
                    c3
                    d6 {The same solid structure.}
                    Re1
                    a6
                """,
            },
            {
                "name": "Italian, 4.d3",
                "weight": 2,
                "moves": """
                    e4 e5 Nf3 Nc6 Bc4 Bc5
                    d3
                    Nf6 {Develop.}
                    c3
                    d6
                    O-O
                    O-O
                    Re1
                    a6 {Keep the bishop safe from b4 or d4.}
                """,
            },
        ],
    },
    {
        "id": "qgd-black",
        "name": "Queen's Gambit Declined",
        "color": "black",
        "summary": "Answer 1.d4 2.c4 with ...e6: keep a strong pawn on d5, develop calmly, castle, and free your game with ...c5 or ...e5.",
        "length": 10,
        "lines": [
            {
                "name": "Tartakower",
                "weight": 3,
                "moves": """
                    d4
                    d5 {Take your share of the center.}
                    c4
                    e6 {Decline: support d5 with a pawn.}
                    Nc3
                    Nf6 {Develop and defend d5.}
                    Bg5
                    Be7 {Break the pin.}
                    e3
                    O-O {King to safety.}
                    Nf3
                    h6 {Ask the bishop to decide.}
                    Bh4
                    b6 {The Tartakower: develop the light-squared bishop on b7.}
                    Be2
                    Bb7
                    Bxf6
                    Bxf6 {Recapture: your bishop pair is a long-term asset.}
                    cxd5
                    exd5 {Solid pawn on d5; ...c5 comes later.}
                """,
            },
            {
                "name": "Exchange (4.cxd5)",
                "weight": 2,
                "moves": """
                    d4 d5 c4 e6 Nc3 Nf6
                    cxd5
                    exd5 {Recapture with the pawn; your bishop on c8 is freed.}
                    Bg5
                    Be7
                    e3
                    O-O
                    Bd3
                    Nbd7 {Develop; the knight can go to f8 to guard the kingside.}
                    Qc2
                    Re8
                    Nge2
                    Nf8 {A typical regrouping: the knight defends h7.}
                    O-O
                    c6 {Solid support for d5.}
                """,
            },
            {
                "name": "Catalan (3.Nf3 4.g3)",
                "weight": 2,
                "moves": """
                    d4 d5 c4 e6
                    Nf3
                    Nf6
                    g3
                    Be7 {Develop and castle quickly.}
                    Bg2
                    O-O
                    O-O
                    dxc4 {Take the pawn: White has to spend time winning it back.}
                    Qc2
                    a6 {Prepare ...b5.}
                    Qxc4
                    b5 {Gain space with tempo on the queen.}
                    Qc2
                    Bb7 {The bishop fights White's Catalan bishop on the long diagonal.}
                """,
            },
        ],
    },
    {
        "id": "slav-black",
        "name": "Slav Defense",
        "color": "black",
        "summary": "Answer 2.c4 with 2...c6: hold d5 with a pawn and keep the light-squared bishop free to develop.",
        "length": 10,
        "lines": [
            {
                "name": "Main line (4.Nc3 dxc4)",
                "weight": 3,
                "moves": """
                    d4
                    d5
                    c4
                    c6 {The Slav: support d5 without locking in the bishop.}
                    Nf3
                    Nf6 {Develop.}
                    Nc3
                    dxc4 {Take the pawn; White must spend time winning it back.}
                    a4
                    Bf5 {Develop the bishop outside the pawn chain.}
                    e3
                    e6
                    Bxc4
                    Bb4 {Pin the knight.}
                    O-O
                    O-O {King to safety.}
                    Qe2
                    Nbd7 {Prepare ...Bg6 when e4 comes.}
                    e4
                    Bg6 {Keep the bishop on its diagonal.}
                """,
            },
            {
                "name": "Slow Slav (4.e3)",
                "weight": 2,
                "moves": """
                    d4 d5 c4 c6 Nf3 Nf6
                    e3
                    Bf5 {Develop the bishop before ...e6.}
                    Nc3
                    e6
                    Nh4 {White goes after your bishop.}
                    Bg6
                    Nxg6
                    hxg6 {Recapture toward the center; the h-file is half open for your rook.}
                    Bd3
                    Nbd7
                    O-O
                    Bd6
                """,
            },
            {
                "name": "Exchange Slav",
                "weight": 2,
                "moves": """
                    d4 d5 c4 c6
                    cxd5
                    cxd5 {Symmetrical structure.}
                    Nc3
                    Nf6
                    Bf4
                    Nc6 {Develop and pressure d4.}
                    e3
                    Bf5 {Bishop out before ...e6.}
                    Nf3
                    e6
                    Qb3
                    Bb4 {Pin and counter-attack.}
                    Bb5
                    O-O
                """,
            },
        ],
    },
    {
        "id": "kings-indian",
        "name": "King's Indian Defense",
        "color": "black",
        "summary": "Let White build a big center, castle behind a fianchettoed bishop, then attack it with ...e5 and ...f5.",
        "length": 10,
        "lines": [
            {
                "name": "Classical",
                "weight": 3,
                "moves": """
                    d4
                    Nf6 {Develop and stop e4 for now.}
                    c4
                    g6 {Prepare the fianchetto.}
                    Nc3
                    Bg7 {The King's Indian bishop: it will bite on White's center.}
                    e4
                    d6 {Control e5 and get ready for ...e5.}
                    Nf3
                    O-O {King to safety first.}
                    Be2
                    e5 {Strike at the center.}
                    O-O
                    Nc6 {Pressure d4.}
                    d5
                    Ne7 {Reroute the knight toward the kingside.}
                    Ne1
                    Nd7 {Clear the f-pawn for ...f5.}
                    f3
                    f5 {The typical King's Indian kingside attack begins.}
                """,
            },
            {
                "name": "Sämisch (5.f3)",
                "weight": 2,
                "moves": """
                    d4 Nf6 c4 g6 Nc3 Bg7 e4 d6
                    f3
                    O-O {Castle first.}
                    Be3
                    e5 {Hit the center anyway.}
                """,
            },
            {
                "name": "Fianchetto (3.Nf3 4.g3)",
                "weight": 2,
                "moves": """
                    d4 Nf6 c4 g6
                    Nf3
                    Bg7
                    g3
                    O-O
                    Bg2
                    d6
                    O-O
                    Nbd7 {Prepare ...e5.}
                    Nc3
                    e5 {Strike at d4.}
                    e4
                    c6 {Control d5 and prepare ...Qb6 or ...a5.}
                    h3
                    Qb6 {Pressure d4 and b2.}
                """,
            },
        ],
    },
]
