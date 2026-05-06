const DH29_PRESET = Object.freeze({
    id: 'dh-29-status-mvp',
    name: 'DH-29 Status MVP',
    tagName: '상태창',
    blockerText: [
        '이번 응답에서는 <상태창> 태그를 절대 출력하지 마세요.',
        'Day, 기분, 생각, 위치, 행동 같은 상태 정보도 출력하지 마세요.',
        '오직 RP 본문, 대화, 묘사만 작성하세요.',
    ].join('\n'),
});

export function getDh29Preset() {
    return DH29_PRESET;
}
