import sys
import time
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Room, DISTANCE, COLORS, BASE_SPEED, ROW_GAP

class RaceTests(unittest.TestCase):
    def test_join_and_capacity_and_nicknames(self):
        room=Room()
        for i in range(7):
            r=room.join('학생'+str(i),COLORS[i%4])
            self.assertEqual(r.distance,0)
        with self.assertRaises(ValueError):room.join('추가',COLORS[0])
        self.assertEqual(len(set(r.token for r in room.players.values())),7)
        self.assertEqual(len(set(tuple(tuple(o['kind'] for o in row['items']) for row in list(r.rows)[:5]) for r in room.players.values())),7)
    def test_speed_stages(self):
        room=Room();r=room.join('학생','#328bb8')
        for d,factor in [(0,1.5),(DISTANCE/3+10,2.0),(DISTANCE*2/3+10,3.0)]:
            r.distance=d;r.energy=0;r.penalty=0
            self.assertAlmostEqual(room.pace(r),BASE_SPEED*factor)
            r.energy=60
            self.assertAlmostEqual(room.pace(r),BASE_SPEED*factor*.7)
            r.penalty=2.2
            self.assertAlmostEqual(room.pace(r),BASE_SPEED*factor*.5)
    def test_teacher_controlled_results_and_reset(self):
        room=Room();rs=[room.join('학생'+str(i),COLORS[i%4]) for i in range(7)]
        now=time.monotonic()
        room.start(now)
        self.assertEqual(room.phase,'countdown')
        room.tick(now+3.6)
        self.assertEqual(room.phase,'running')
        self.assertEqual(room.state(player=rs[0])['phase'],'running')
        t=now+3.6
        for _ in range(5500):
            t+=.045
            room.tick(t)
            if room.phase=='finished':break
        self.assertEqual(room.phase,'finished')
        self.assertTrue(all(r.finish is not None for r in rs))
        student=room.state(player=rs[0]);self.assertTrue(all(p['rank'] is None and 'time' not in p for p in student['players']))
        teacher=room.state(teacher=True)
        self.assertEqual(len(teacher['players']),7)
        self.assertTrue(all(p['time'] for p in teacher['players']))
        room.phase='revealed';self.assertTrue(all(p['time'] for p in room.state(player=rs[0])['players']))
        room.reset();self.assertEqual(room.phase,'lobby')
        self.assertTrue(all(r.distance==0 and r.finish is None for r in rs))

if __name__=='__main__':unittest.main()
