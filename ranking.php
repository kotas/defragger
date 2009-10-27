<?php

define('TIMEHASH_SECRET', 'hoge');
define('RANKING_FILE_PATH', dirname(__FILE__) . '/rankingdata.json');
define('RANKING_SAVE_NUM',  50);

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] == 'GET') {

	if ($_SERVER['PATH_INFO'] == '/timehash') {
		$time = time();
		$hash = sha1($time . $_SERVER['REMOTE_ADDR'] . TIMEHASH_SECRET);
		echo json_encode(array('timehash' => $hash, 'time' => $time));
	} else {
		if (file_exists(RANKING_FILE_PATH)) {
			readfile(RANKING_FILE_PATH);
		} else {
			echo '[]';
		}
	}

} else {

	$score = array(
		'hash'      => $_POST['timehash'],
		'started'   => $_POST['time'],
		'posted'    => time(),
		'score'     => $_POST['score'],
		'erased'    => $_POST['erased'],
		'combo'     => $_POST['combo'],
		'nickname'  => $_POST['nickname'],
	);

	foreach ($score as $key => $value) {
		switch ($key) {
			case 'hash':
				if (!isset($value) || !ctype_xdigit($value))
					{ header(' ', true, 400); die('"bad request"'); }
				break;
			case 'started':
			case 'score':
			case 'erased':
			case 'combo':
				if (!isset($value) || !ctype_digit($value))
					{ header(' ', true, 400); die('"bad request"'); }
				$score[$key] = intval($value);
				break;
			case 'nickname':
				if (!isset($value) || empty($value) ||
						!mb_check_encoding($val, 'UTF-8') ||
						mb_strlen($value, 'UTF-8') > 20)
					{ header(' ', true, 400); die('"bad request"'); }
				break;
		}
	}

	if (sha1($score['started'] . $_SERVER['REMOTE_ADDR'] . TIMEHASH_SECRET) !== $score['hash'])
		{ header(' ', true, 400); die('"bad timehash"'); }

	$fp = fopen(RANKING_FILE_PATH, 'r+') or die('"internal error"');
	flock($fp, LOCK_EX) or die('"internal error"');

	$ranking_json = stream_get_contents($fp);
	if ($ranking_json) {
		$ranking = json_decode($ranking_json, true);
	} else {
		$ranking = array();
	}

	foreach ($ranking as $s) {
		if ($s['hash'] == $score['hash'])
			{ header(' ', true, 400); die('"double posted"'); }
	}

	$ranking[] = $score;
	usort($ranking, create_function('$a, $b', 'return $b["score"] - $a["score"];'));
	$ranking = array_slice($ranking, 0, RANKING_SAVE_NUM);
	$ranking_json = json_encode($ranking);

	rewind($fp);
	ftruncate($fp, 0);
	fwrite($fp, $ranking_json);
	fclose($fp);

	echo $ranking_json;

}


?>